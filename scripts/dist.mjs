// Builds the desktop installers.
//   npm run dist         installers for the system you're on
//   npm run dist:win     Windows installers (on Windows)
//   npm run dist:linux   Linux .AppImage and .deb (on Linux)
//
// Each system can only build its own installers: Linux packages need Linux
// file links and packaging tools that Windows doesn't have, and the Windows
// installer needs Windows tools. Asking for the other system stops right away
// with what to do instead; GitHub Actions (.github/workflows/build.yml) builds
// both in the cloud for people with only one kind of machine.
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

const host = process.platform === 'win32' ? 'win' : process.platform === 'linux' ? 'linux' : null;
const platform = process.argv.includes('--linux') ? 'linux' : process.argv.includes('--win') ? 'win' : host;
const NAME = { win: 'Windows', linux: 'Linux' };

if (!host) {
  console.error('FlowDoc installers can be built on Windows or Linux. This system (macOS) is not supported yet.');
  process.exit(1);
}
if (platform !== host) {
  console.error(
    [
      '',
      `${NAME[platform]} installers can't be built on ${NAME[host]}.`,
      platform === 'linux'
        ? "Linux packages (.AppImage, .deb) need Linux file links and packaging tools that Windows doesn't have."
        : "The Windows installer needs Windows packaging tools that Linux doesn't have.",
      '',
      `To install FlowDoc on this ${NAME[host]} computer, run:`,
      '',
      '    npm run dist',
      '',
      `To get ${NAME[platform]} installers without a ${NAME[platform]} computer, use the "Build installers"`,
      'workflow on GitHub: open the repository > Actions > Build installers > Run workflow,',
      'then download the files from the finished run (see "Build installers in the cloud" in README.md).',
      '',
    ].join('\n'),
  );
  process.exit(1);
}
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
