// File-backed key/value store for the desktop app. Each key is one JSON file
// under <userData>/library, written atomically (temp file + rename) and
// serialised per key so the recorder and the editor can't interleave writes.
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function createFileStore(dir, { onChange } = {}) {
  const ready = mkdir(dir, { recursive: true });
  const chains = new Map();
  const fileFor = (key) => join(dir, `${String(key).replace(/[^\w.-]/g, '_')}.json`);

  const serial = (key, fn) => {
    const run = (chains.get(key) || Promise.resolve()).then(fn, fn);
    chains.set(key, run.catch(() => {}));
    return run;
  };

  return {
    dir,
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
