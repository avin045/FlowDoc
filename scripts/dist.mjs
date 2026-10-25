// Builds the desktop installers.   node scripts/dist.mjs --win | --linux
//
// electron-builder deletes and rewrites thousands of files while packaging.
// Anything that watches the project folder (an editor's file indexer, an
// antivirus scanner, the Claude desktop app) can hold one of them open for a
// moment, and the build then dies with "EBUSY: resource busy or locked".
// So the build runs in a temporary folder outside the project and only the
// finished installers are copied into dist/.
import builder from 'electron-builder';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { build, Platform } = builder;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const platform = process.argv.includes('--linux') ? 'linux' : process.argv.includes('--win') ? 'win' : process.platform === 'linux' ? 'linux' : 'win';
const work = join(tmpdir(), `flowdoc-build-${platform}`);
const dist = join(root, 'dist');

// electron-builder caches its tools (NSIS, 7-Zip, Electron) under
// %LOCALAPPDATA%. If that folder carries the Windows "Encrypted" (EFS)
// attribute, every cached file inherits it, and Windows refuses to copy those
// files anywhere it can't keep the encryption (always, on Windows Home). The
// installer step then fails with "copyfile … elevate.exe: UNKNOWN". A cache in
// the (unencrypted) temp folder avoids that.
process.env.ELECTRON_BUILDER_CACHE ||= join(tmpdir(), 'flowdoc-builder-cache');

rmSync(work, { recursive: true, force: true });
console.log(`Building FlowDoc for ${platform} in ${work}`);

let artifacts;
try {
  artifacts = await build({
    projectDir: root,
    targets: (platform === 'linux' ? Platform.LINUX : Platform.WINDOWS).createTarget(),
    config: { ...pkg.build, directories: { ...pkg.build.directories, output: work } },
  });
} catch (err) {
  console.error(`\nBuild failed: ${err.message}`);
  process.exit(1);
}

mkdirSync(dist, { recursive: true });
const copied = [];
for (const file of artifacts.filter((f) => /\.(exe|AppImage|deb|rpm|yml|blockmap)$/i.test(f))) {
  const target = join(dist, basename(file));
  try {
    copyFileSync(file, target);
    copied.push(target);
  } catch (err) {
    console.warn(`Could not copy ${basename(file)} into dist/ (${err.code}); it is still at ${file}`);
  }
}
console.log('\nDone. Installers:');
for (const f of copied.filter((f) => !/\.(yml|blockmap)$/i.test(f))) console.log(`  ${f}`);
console.log(`\nUnpacked app (for quick testing): ${join(work, platform === 'linux' ? 'linux-unpacked' : 'win-unpacked')}`);
