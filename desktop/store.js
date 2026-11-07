// File-backed key/value store for the desktop app. Each key is one JSON file
// in the guides folder (by default <userData>/library; users can choose their
// own in Settings), written atomically (temp file + rename) and serialised per
// key so the recorder and the editor can't interleave writes.
//
// Screenshots and thumbnails are not kept inside the guide files: each image
// is written once to <folder>/assets/<hash>.<ext> and the guide refers to it
// as app://flowdoc/assets/<hash>.<ext> (served by main.js). A guide file is
// then a few kilobytes, so saving a step (which rewrites the guide) stays
// quick however long the guide gets. The guide list is kept in memory and
// written shortly after it changes.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { access, constants, copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const INDEX = 'guides_index';
const fileName = (key) => `${String(key).replace(/[^\w.-]/g, '_')}.json`;

const ASSETS = 'assets';
export const ASSET_URL = 'app://flowdoc/assets/';
const ASSET_NAME = /^[0-9a-f]{40}\.(jpg|png|webp|gif)$/;
const ASSET_REF = /assets\/([0-9a-f]{40}\.(?:jpg|png|webp|gif))/g;
const DATA_IMAGE = /^data:image\/(jpeg|png|webp|gif);base64,/;
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };
const INDEX_DELAY_MS = 300;
// Unreferenced images younger than this are kept: a guide may be about to use them.
const ASSET_GRACE_MS = 60 * 60_000;

export function createFileStore(initialDir, { onChange } = {}) {
  let dir = initialDir;
  let ready = mkdir(dir, { recursive: true });
  const chains = new Map();
  const fileFor = (key) => join(dir, fileName(key));
  const known = new Set(); // asset files known to exist in `dir`

  const serial = (key, fn) => {
    const run = (chains.get(key) || Promise.resolve()).then(fn, fn);
    chains.set(key, run.catch(() => {}));
    return run;
  };

  async function writeAtomic(file, text) {
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, text);
    await renameRetry(tmp, file);
  }

  async function readJson(key) {
    try {
      return JSON.parse(await readFile(fileFor(key), 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  // ---------- images ----------

  // Writes an image (a data: URL) as a file, named by its contents, and
  // returns the URL to refer to it by. The same image is stored once.
  async function storeImage(dataUrl) {
    const m = DATA_IMAGE.exec(dataUrl);
    if (!m) return dataUrl;
    const bytes = Buffer.from(dataUrl.slice(m[0].length), 'base64');
    const name = `${createHash('sha256').update(bytes).digest('hex').slice(0, 40)}.${EXT[m[1]]}`;
    if (!known.has(name)) {
      const folder = join(dir, ASSETS);
      const file = join(folder, name);
      try {
        await access(file);
      } catch {
        await mkdir(folder, { recursive: true });
        const tmp = `${file}.${process.pid}.${known.size}.tmp`;
        await writeFile(tmp, bytes);
        await renameRetry(tmp, file).catch(async (err) => {
          await rm(tmp, { force: true });
          if (err.code !== 'EEXIST') throw err;
        });
      }
      known.add(name);
    }
    return ASSET_URL + name;
  }

  // Moves the images of a guide (screenshots, thumbnail) or of the guide list
  // (thumbnails) out into files. Changes `value` in place.
  async function storeImages(key, value) {
    if (!value || typeof value !== 'object') return value;
    const swap = async (obj, field) => {
      if (typeof obj?.[field] === 'string' && DATA_IMAGE.test(obj[field])) obj[field] = await storeImage(obj[field]);
    };
    if (key === INDEX && Array.isArray(value)) {
      for (const entry of value) await swap(entry, 'thumb');
    } else if (String(key).startsWith('guide_')) {
      await swap(value, 'thumb');
      for (const step of Array.isArray(value.steps) ? value.steps : []) await swap(step, 'screenshot');
    }
    return value;
  }

  // ---------- the guide list, kept in memory ----------

  let index; // undefined = not read yet
  let indexTimer = null;
  let indexDirty = false;

  async function loadIndex() {
    if (index === undefined) index = (await readJson(INDEX)) ?? null;
    return index;
  }
  function flushIndex() {
    clearTimeout(indexTimer);
    indexTimer = null;
    if (!indexDirty) return chains.get(INDEX) || Promise.resolve();
    indexDirty = false;
    const text = JSON.stringify(index);
    const file = fileFor(INDEX);
    return serial(INDEX, async () => {
      await ready;
      await writeAtomic(file, text);
    });
  }

  return {
    get dir() {
      return dir;
    },
    // Switches to another folder once pending writes have finished.
    async setDir(next) {
      await Promise.all([...chains.values()]);
      await flushIndex();
      dir = next;
      index = undefined;
      known.clear();
      ready = mkdir(dir, { recursive: true });
      await ready;
      onChange?.(INDEX, 'folder');
    },
    async get(key) {
      await ready;
      if (key === INDEX) {
        const value = await loadIndex();
        return value == null ? undefined : structuredClone(value);
      }
      return readJson(key);
    },
    set(key, value, { source } = {}) {
      if (key === INDEX) {
        // In order, so a slower earlier list can't replace a later one.
        return serial('#index', async () => {
          await ready;
          index = await storeImages(INDEX, structuredClone(value));
          indexDirty = true;
          clearTimeout(indexTimer);
          indexTimer = setTimeout(flushIndex, INDEX_DELAY_MS);
          onChange?.(key, source);
        });
      }
      return serial(key, async () => {
        await ready;
        await writeAtomic(fileFor(key), JSON.stringify(await storeImages(key, value)));
        onChange?.(key, source);
      });
    },
    remove(key, { source } = {}) {
      return serial(key, async () => {
        await ready;
        if (key === INDEX) {
          index = null;
          indexDirty = false;
          clearTimeout(indexTimer);
        }
        await rm(fileFor(key), { force: true });
        onChange?.(key, source);
      });
    },
    // The file behind an app://flowdoc/assets/<name> URL, or null.
    assetPath(name) {
      return ASSET_NAME.test(name) ? join(dir, ASSETS, name) : null;
    },
    // Writes the guide list now (before quitting, or copying the folder).
    async flush() {
      await chains.get('#index');
      await flushIndex();
    },
    flushSync() {
      clearTimeout(indexTimer);
      if (!indexDirty) return;
      indexDirty = false;
      try {
        writeFileSync(fileFor(INDEX), JSON.stringify(index));
      } catch {
        /* quitting anyway */
      }
    },
    // Background upkeep, once per session: guides saved before images were
    // kept as files are converted, and images no guide uses any more (deleted
    // guides, replaced screenshots) are removed.
    async tidy({ graceMs = ASSET_GRACE_MS } = {}) {
      await ready;
      const at = dir;
      const names = (await readdir(at).catch(() => [])).filter((n) => /^guide_.*\.json$/.test(n));
      const used = new Set();
      let converted = 0;
      for (const n of names) {
        const key = n.slice(0, -'.json'.length);
        await serial(key, async () => {
          if (dir !== at) return;
          let text;
          try {
            text = await readFile(join(at, n), 'utf8');
          } catch {
            return;
          }
          if (text.includes('"data:image/')) {
            text = JSON.stringify(await storeImages(key, JSON.parse(text)));
            await writeAtomic(join(at, n), text);
            converted++;
          }
          for (const m of text.matchAll(ASSET_REF)) used.add(m[1]);
        });
      }
      const list = await loadIndex();
      if (Array.isArray(list) && list.some((g) => typeof g.thumb === 'string' && DATA_IMAGE.test(g.thumb))) {
        await storeImages(INDEX, list);
        indexDirty = true;
        await flushIndex();
      }
      for (const m of JSON.stringify(index ?? null).matchAll(ASSET_REF)) used.add(m[1]);
      let removed = 0;
      const folder = join(at, ASSETS);
      for (const name of await readdir(folder).catch(() => [])) {
        if (!ASSET_NAME.test(name) || used.has(name) || dir !== at) continue;
        try {
          if (Date.now() - (await stat(join(folder, name))).mtimeMs < graceMs) continue;
          await rm(join(folder, name), { force: true });
          known.delete(name);
          removed++;
        } catch {
          /* in use or already gone */
        }
      }
      return { converted, removed };
    },
  };
}

// On Windows a rename fails for a moment while another program (antivirus,
// the search indexer) has the target open. Try again briefly before giving up.
async function renameRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to);
    } catch (err) {
      if (attempt >= 8 || !['EPERM', 'EACCES', 'EBUSY'].includes(err.code)) throw err;
      await new Promise((r) => setTimeout(r, 25 * (attempt + 1)));
    }
  }
}

// ---------- guides folder helpers ----------

async function readIndex(folder) {
  try {
    const index = JSON.parse(await readFile(join(folder, fileName(INDEX)), 'utf8'));
    return Array.isArray(index) ? index : [];
  } catch {
    return [];
  }
}

// Creates the folder if needed and checks FlowDoc can write files in it.
export async function ensureWritable(folder) {
  try {
    await mkdir(folder, { recursive: true });
    const probe = join(folder, `.flowdoc-write-test-${process.pid}`);
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Looks at a folder the user picked and decides where guides would go:
 * - already a FlowDoc library, or empty: use it as is;
 * - anything else: a "FlowDoc Guides" subfolder inside it, so FlowDoc's
 *   files don't get mixed with the user's own.
 */
export async function inspectFolder(chosen) {
  let entries;
  try {
    if (!(await stat(chosen)).isDirectory()) return { ok: false, chosen, reason: 'That is a file, not a folder.' };
    entries = await readdir(chosen);
  } catch (err) {
    if (err.code !== 'ENOENT') return { ok: false, chosen, reason: `Can't open that folder (${err.code}).` };
    entries = []; // will be created
  }
  const isLibrary = entries.includes(fileName(INDEX));
  const visible = entries.filter((e) => !e.startsWith('.'));
  const target = isLibrary || !visible.length ? chosen : join(chosen, 'FlowDoc Guides');
  const writable = await ensureWritable(target);
  return {
    ok: writable,
    chosen,
    target,
    subfolder: target !== chosen,
    existingGuides: (await readIndex(target)).length,
    reason: writable ? '' : "FlowDoc can't write to that folder. Choose one you have permission to change.",
  };
}

// At startup: the saved folder must still exist (a missing drive or deleted
// folder is not silently recreated) and be writable.
export async function folderUsable(folder) {
  try {
    await access(folder, constants.W_OK);
    return ensureWritable(folder);
  } catch {
    return false;
  }
}

/**
 * Copies guides from one folder into another. Guides already in the target
 * are kept (the newer copy wins if both have the same guide); the source is
 * left untouched as a backup. Returns how many guides were copied.
 */
export async function mergeLibrary(from, to) {
  if (from === to) return 0;
  await mkdir(to, { recursive: true });
  const [source, target] = await Promise.all([readIndex(from), readIndex(to)]);
  const byId = new Map(target.map((g) => [g.id, g]));
  let copied = 0;
  for (const entry of source) {
    const existing = byId.get(entry.id);
    if (existing && (existing.updatedAt || 0) >= (entry.updatedAt || 0)) continue;
    try {
      const data = await readFile(join(from, fileName(`guide_${entry.id}`)));
      const dest = join(to, fileName(`guide_${entry.id}`));
      await writeFile(`${dest}.tmp`, data);
      await rename(`${dest}.tmp`, dest);
      byId.set(entry.id, entry);
      copied++;
    } catch {
      /* guide file missing in the source: skip it */
    }
  }
  // Images are named by their contents, so any the target lacks can be copied as they are.
  const assetsFrom = join(from, ASSETS);
  const assetsTo = join(to, ASSETS);
  const have = new Set(await readdir(assetsTo).catch(() => []));
  for (const name of await readdir(assetsFrom).catch(() => [])) {
    if (!ASSET_NAME.test(name) || have.has(name)) continue;
    await mkdir(assetsTo, { recursive: true });
    await copyFile(join(assetsFrom, name), join(assetsTo, name)).catch(() => {});
  }
  const index = join(to, fileName(INDEX));
  await writeFile(`${index}.tmp`, JSON.stringify([...byId.values()]));
  await rename(`${index}.tmp`, index);
  return copied;
}
