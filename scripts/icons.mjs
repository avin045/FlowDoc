// Renders the FlowDoc logo SVG into the PNG sizes the extension manifest needs.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#4f46e5"/>
  <rect x="26" y="30" width="54" height="12" rx="6" fill="#fff" opacity=".55"/>
  <rect x="26" y="58" width="76" height="12" rx="6" fill="#fff" opacity=".8"/>
  <rect x="26" y="86" width="44" height="12" rx="6" fill="#fff"/>
  <circle cx="96" cy="92" r="14" fill="#f43f5e" stroke="#fff" stroke-width="5"/>
</svg>`;

writeFileSync(join(root, 'extension', 'icons', 'logo.svg'), logoSvg);

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}</style>` +
      logoSvg.replace('<svg ', `<svg width="${size}" height="${size}" `),
  );
  await page.screenshot({ path: join(root, 'extension', 'icons', `icon${size}.png`), omitBackground: true });
  console.log(`[icons] icon${size}.png`);
}
// Desktop installers (electron-builder) want a 512px source icon.
mkdirSync(join(root, 'build'), { recursive: true });
await page.setViewportSize({ width: 512, height: 512 });
await page.setContent(`<style>html,body{margin:0;background:transparent}</style>` + logoSvg.replace('<svg ', '<svg width="512" height="512" '));
await page.screenshot({ path: join(root, 'build', 'icon.png'), omitBackground: true });
console.log('[icons] build/icon.png');
await browser.close();
