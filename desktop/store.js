// File-backed key/value store for the desktop app. Each key is one JSON file
// in the guides folder (by default <userData>/library; users can choose their
// own in Settings), written atomically (temp file + rename) and serialised per
// key so the recorder and the editor can't interleave writes.
import { access, constants, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const INDEX = 'guides_index';
const fileName = (key) => `${String(key).replace(/[^\w.-]/g, '_')}.json`;

export function createFileStore(initialDir, { onChange } = {}) {
  let dir = initialDir;
  let ready = mkdir(dir, { recursive: true });
  const chains = new Map();
  const fileFor = (key) => join(dir, fileName(key));

  const serial = (key, fn) => {
    const run = (chains.get(key) || Promise.resolve()).then(fn, fn);
    chains.set(key, run.catch(() => {}));
    return run;
  };

  return {
    get dir() {
      return dir;
    },
    // Switches to another folder once pending writes have finished.
    async setDir(next) {
      await Promise.all([...chains.values()]);
      dir = next;
      ready = mkdir(dir, { recursive: true });
      await ready;
      onChange?.(INDEX, 'folder');
    },
    async get(key) {
      await ready;
      try {
        return JSON.parse(await readFile(fileFor(key), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return undefined;
        throw err;
      }
    },
    set(key, value, { source } = {}) {
      return serial(key, async () => {
        await ready;
        const file = fileFor(key);
        const tmp = `${file}.${process.pid}.tmp`;
        await writeFile(tmp, JSON.stringify(value));
        await rename(tmp, file);
        onChange?.(key, source);
      });
    },
    remove(key, { source } = {}) {
      return serial(key, async () => {
        await ready;
        await rm(fileFor(key), { force: true });
        onChange?.(key, source);
      });
    },
  };
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
  const index = join(to, fileName(INDEX));
  await writeFile(`${index}.tmp`, JSON.stringify([...byId.values()]));
  await rename(`${index}.tmp`, index);
  return copied;
}
