// Copies the browser builds of the export libraries into extension/vendor.
// Manifest V3 forbids remotely hosted code, so they have to ship inside the extension.
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'extension', 'vendor');
mkdirSync(out, { recursive: true });

const files = [
  ['node_modules/jspdf/dist/jspdf.umd.min.js', 'jspdf.umd.min.js'],
  ['node_modules/docx/dist/index.iife.js', 'docx.iife.js'],
  ['node_modules/jszip/dist/jszip.min.js', 'jszip.min.js'],
];

for (const [from, to] of files) {
  const src = join(root, from);
  if (!existsSync(src)) {
    console.warn(`[vendor] missing ${from} - run "npm install" first`);
    continue;
  }
  copyFileSync(src, join(out, to));
  console.log(`[vendor] ${from} -> extension/vendor/${to}`);
}
