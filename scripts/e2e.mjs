// End-to-end check: loads the unpacked extension in Chromium, records a
// session on the demo site, edits the guide and runs every exporter.
//   node scripts/e2e.mjs [outDir]
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './serve.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const extensionPath = join(root, 'extension');
const out = process.argv[2] || join(root, 'test-output');
mkdirSync(out, { recursive: true });

const PORT = 5199;
const server = await startServer(PORT);
const profile = mkdtempSync(join(tmpdir(), 'flowdoc-e2e-'));
let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? '  ✔' : '  ✘'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// BROWSER=msedge (or chrome) runs against an installed browser instead of
// Playwright's bundled Chromium; BROWSER_PATH points at any Chromium binary.
const context = await chromium.launchPersistentContext(profile, {
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: process.env.BROWSER || 'chromium' }),
  headless: !process.env.HEADED,
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
});

try {
  // Edge runs its own component extensions too; pick ours by script name.
  const ours = (w) => w.url().startsWith('chrome-extension://') && w.url().endsWith('/background.js');
  let worker = context.serviceWorkers().find(ours);
  worker ??= await context.waitForEvent('serviceworker', { predicate: ours });
  const extId = worker.url().split('/')[2];
  console.log(`Extension loaded: ${extId}`);

  // ---------- record ----------
  console.log('\nRecording on the demo site');
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(`http://localhost:${PORT}/demo/`);
  await page.bringToFront();
  // Drive the background worker the way the popup does, from an extension page.
  const control = await context.newPage();
  await control.goto(`chrome-extension://${extId}/popup.html`);
  const send = (message) => control.evaluate((m) => chrome.runtime.sendMessage(m), message);
  const tabId = await control.evaluate(async (url) => (await chrome.tabs.query({ url })).at(0)?.id, `http://localhost:${PORT}/demo/*`);
  await page.bringToFront();
  await send({ type: 'start', tabId });
  await page.waitForSelector('flowdoc-recorder', { state: 'attached' });

  await page.click('#email');
  await page.keyboard.type('alex@northwind.example', { delay: 20 });
  await page.waitForTimeout(1600);
  await page.click('#password');
  await page.keyboard.type('hunter22', { delay: 20 });
  await page.focus('#region');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(700);
  await page.click('label[for=remember]');
  await page.waitForTimeout(700);
  await page.click('button[type=submit]');
  await page.waitForURL(/ticket\.html/);
  await page.waitForSelector('flowdoc-recorder', { state: 'attached' });
  await page.waitForTimeout(600);
  await page.click('#subject');
  await page.keyboard.type('Cannot export invoices', { delay: 15 });
  await page.waitForTimeout(400);
  await page.click('#submit');
  await page.waitForTimeout(1500);

  const state = await send({ type: 'getState' });
  check(state.active && state.stepCount >= 6, 'recording is active and counting steps', `${state.stepCount} steps`);

  const appPagePromise = context.waitForEvent('page');
  await send({ type: 'stop' });
  const app = await appPagePromise;
  await app.waitForLoadState();
  await app.waitForSelector('.block .shot img', { timeout: 15000 });
  check(!(await page.$('flowdoc-recorder')), 'recorder widget removed after stop');

  const guideId = app.url().split('/').pop();
  const guide = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
  console.log('\nCaptured steps:');
  guide.steps.forEach((s, i) => console.log(`   ${i + 1}. [${s.action}] ${s.text}${s.screenshot ? '' : '  (no screenshot)'}`));
  const texts = guide.steps.map((s) => s.text);
  check(guide.title.includes('localhost'), 'default title set', guide.title);
  check(texts[0]?.startsWith('Navigate to'), 'first step navigates to the start page');
  check(texts.some((t) => t === 'Type "alex@northwind.example" in the **Email** field'), 'typed email captured with field label');
  check(texts.some((t) => t === 'Type your password in the **Password** field'), 'password value is masked');
  check(!JSON.stringify(guide).includes('hunter22'), 'password never stored');
  check(texts.some((t) => /^Select \*\*Europe\*\* from \*\*Region\*\*$/.test(t)), 'select change captured');
  check(texts.some((t) => t === 'Check **Remember me**'), 'checkbox via label captured');
  check(texts.some((t) => t === 'Click **Sign in**'), 'button click captured');
  check(texts.some((t) => t === 'Type "Cannot export invoices" in the **Subject** field'), 'typing on second page captured');
  check(texts.some((t) => t === 'Click **Submit ticket**'), 'final click captured');
  const shots = guide.steps.filter((s) => s.screenshot);
  check(shots.length >= guide.steps.length - 1, 'steps carry screenshots', `${shots.length}/${guide.steps.length}`);
  check(guide.steps.filter((s) => s.target).every((s) => s.target.w > 0), 'target rectangles recorded');

  await app.screenshot({ path: join(out, 'editor.png') });

  // ---------- edit ----------
  console.log('\nEditing');
  await app.fill('.title-input', 'How to open a support ticket in Northwind');
  await app.fill('.desc-input', 'Sign in to the support portal and file a new ticket.');
  // fill() doesn't fire trusted input events in every case, so type a char too
  await app.click('.title-input');
  await app.keyboard.press('End');
  await app.keyboard.type('!');
  await app.keyboard.press('Backspace');
  await app.click('.desc-input');
  await app.keyboard.press('End');
  await app.keyboard.type(' ');
  await app.keyboard.press('Backspace');

  // add a tip at the end
  await app.click('[data-add="tip"]');
  await app.keyboard.type('Use the Urgent priority only for outages.');
  await app.keyboard.press('Enter');

  // redact part of the second screenshot
  const second = app.locator('.block.kind-action').nth(1);
  await second.hover();
  await second.locator('[data-shot="edit"]').click();
  const overlay = app.locator('.ie-overlay');
  const box = await overlay.boundingBox();
  await app.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.3);
  await app.mouse.down();
  await app.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.45, { steps: 6 });
  await app.mouse.up();
  await app.screenshot({ path: join(out, 'image-editor.png') });
  await app.click('.image-editor .save');

  // reorder: move the last step up one
  const lastAction = app.locator('.block.kind-action').last();
  await lastAction.hover();
  await lastAction.locator('[aria-label="Move up"]').click();
  await app.waitForTimeout(1200); // autosave

  const edited = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
  check(edited.title === 'How to open a support ticket in Northwind', 'title saved', edited.title);
  check(edited.description.startsWith('Sign in to the support portal'), 'description saved');
  check(edited.steps.some((s) => s.kind === 'tip' && s.text.includes('Urgent')), 'tip block added');
  check(edited.steps.filter((s) => s.kind === 'action')[1].redactions?.length === 1, 'redaction saved');
  check(!!edited.thumb, 'thumbnail generated');

  // undo / redo of the reorder
  const orderBefore = edited.steps.map((s) => s.id).join();
  await app.click('[data-act="undo"]');
  await app.waitForTimeout(800);
  const afterUndo = (await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId)).steps.map((s) => s.id).join();
  check(afterUndo !== orderBefore, 'undo reverts the last change');
  await app.click('[data-act="redo"]');
  await app.waitForTimeout(800);
  const afterRedo = (await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId)).steps.map((s) => s.id).join();
  check(afterRedo === orderBefore, 'redo re-applies it');

  await app.evaluate(() => window.scrollTo(0, 0));
  await app.screenshot({ path: join(out, 'editor-edited.png'), fullPage: true });

  // ---------- export ----------
  console.log('\nExporting');
  const files = {};
  for (const format of ['pdf', 'docx', 'html', 'markdown', 'json']) {
    await app.click('[data-act="export"]');
    await app.click(`label.format:has(input[value="${format}"])`);
    if (format === 'pdf') await app.screenshot({ path: join(out, 'export-dialog.png') });
    const [dl] = await Promise.all([app.waitForEvent('download', { timeout: 30000 }), app.click('dialog .go')]);
    const file = join(out, dl.suggestedFilename());
    await dl.saveAs(file);
    files[format] = file;
    console.log(`   ${format.padEnd(8)} → ${dl.suggestedFilename()}`);
  }

  const pdf = readFileSync(files.pdf);
  const pageCount = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(pdf.subarray(0, 5).toString() === '%PDF-', 'PDF is valid', `${(pdf.length / 1024).toFixed(0)} KB, ${pageCount} pages`);

  const docx = await JSZip.loadAsync(readFileSync(files.docx));
  const docXml = await docx.file('word/document.xml').async('string');
  const media = Object.keys(docx.files).filter((f) => f.startsWith('word/media/') && !f.endsWith('/'));
  check(docXml.includes('How to open a support ticket in Northwind'), 'Word doc contains the title');
  check(docXml.includes('Submit ticket'), 'Word doc contains step text');
  check(media.length >= 8, 'Word doc embeds screenshots', `${media.length} images`);

  const html = readFileSync(files.html, 'utf8');
  check(html.startsWith('<!doctype html>') && (html.match(/<img /g) || []).length >= 8, 'HTML is self-contained with images');
  check(html.includes('class="callout tip"'), 'HTML includes the tip');

  const md = await JSZip.loadAsync(readFileSync(files.markdown));
  const mdText = await md.file('guide.md').async('string');
  const mdImages = Object.keys(md.files).filter((f) => f.startsWith('images/') && !f.endsWith('/'));
  check(mdText.startsWith('# How to open a support ticket in Northwind'), 'Markdown has the title');
  const linked = [...mdText.matchAll(/\]\((images\/step-\d+\.jpg)\)/g)].map((m) => m[1]);
  check(mdImages.length >= 8 && linked.length === mdImages.length && linked.every((p) => mdImages.includes(p)), 'Markdown zip has linked images', `${mdImages.length} images`);

  const json = JSON.parse(readFileSync(files.json, 'utf8'));
  check(json.format === 'flowdoc-guide' && json.guide.steps.length === edited.steps.length, 'JSON backup round-trips');

  // ---------- library ----------
  await app.goto(`chrome-extension://${extId}/app.html#/`);
  await app.waitForSelector('.card');
  check((await app.locator('.card').count()) === 1, 'guide listed in the library');
  await app.screenshot({ path: join(out, 'library.png') });

  // ---------- popup ----------
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 460 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('#recent li');
  await popup.screenshot({ path: join(out, 'popup.png') });
  check((await popup.locator('#recent li').count()) === 1, 'popup lists recent guides');
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await context.close();
  server.close();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
console.log(`Artifacts in ${out}`);
process.exit(failures ? 1 : 0);
