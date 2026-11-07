// End-to-end check: loads the unpacked extension in Chromium, records a
// session on the demo site, edits the guide and runs every exporter.
//   node scripts/e2e.mjs [outDir]
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNotionMock } from './mock-notion.mjs';
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

  // "Highlights" toolbar toggle hides, then shows, the marks on every step.
  const markedHidden = async () =>
    (await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId)).steps
      .filter((s) => s.kind === 'action' && s.screenshot && (s.target || s.click))
      .map((s) => s.highlight === false);
  await app.click('[data-act="highlights"]');
  await app.waitForTimeout(800);
  const hidden = await markedHidden();
  check(hidden.length > 0 && hidden.every(Boolean), 'Highlights toggle hides the mark on every step', `${hidden.length} steps`);
  await app.click('[data-act="highlights"]');
  await app.waitForTimeout(800);
  check((await markedHidden()).every((h) => !h), 'Highlights toggle shows them again');

  // Side panels collapse for a full-width guide, stay collapsed after a reload,
  // and Ctrl+\ brings them back.
  const layout = () =>
    app.evaluate(() => {
      const shown = (sel) => !!document.querySelector(sel)?.getClientRects().length;
      return { sidebar: shown('.sidebar'), outline: shown('.outline'), show: shown('[data-dock="show"]'), doc: Math.round(document.querySelector('.doc').getBoundingClientRect().width) };
    });
  const open = await layout();
  await app.click('[data-dock="hide"]');
  const collapsed = await layout();
  check(!collapsed.sidebar && !collapsed.outline && collapsed.show && collapsed.doc > open.doc, 'collapsing hides the sidebar and Contents and widens the guide', `${open.doc}px → ${collapsed.doc}px`);
  await app.screenshot({ path: join(out, 'editor-collapsed.png') });
  await app.reload();
  await app.waitForSelector('.block');
  check(!(await layout()).sidebar, 'the collapsed layout is remembered after a reload');
  await app.keyboard.press('Control+Backslash');
  const docked = await layout();
  check(docked.sidebar && docked.outline && !docked.show, 'Ctrl+\\ shows the side panels again', JSON.stringify(docked));

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

  // ---------- continue capturing ----------
  console.log('\nContinue capturing');
  const snap = (g) => g.steps.map((s) => `${s.id}|${s.text}`);
  const beforeContinue = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
  await app.click('[data-act="continue"]');
  await app.waitForSelector('dialog .tab-list button');
  check((await app.locator('dialog h2').textContent()) === 'Continue capturing', 'the button asks which tab to carry on in');
  await app.click('dialog .tab-list button');
  await page.waitForSelector('flowdoc-recorder', { state: 'attached' });
  await app.waitForSelector('.recording-banner');
  const contState = await send({ type: 'getState' });
  check(contState.active && contState.guideId === guideId && contState.stepCount === beforeContinue.steps.filter((s) => s.kind === 'action').length, 'capture continues the same guide and counts on', `${contState.stepCount} steps`);
  await page.click('#subject');
  await page.waitForTimeout(400);
  await page.click('#submit');
  await page.waitForTimeout(1500);
  const reopened = context.waitForEvent('page');
  await send({ type: 'stop' });
  await (await reopened).close();
  const continued = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
  const added = continued.steps.slice(beforeContinue.steps.length);
  check(
    added.length >= 2 && JSON.stringify(snap(continued).slice(0, beforeContinue.steps.length)) === JSON.stringify(snap(beforeContinue)) && continued.title === beforeContinue.title,
    'new steps go after the old ones; old steps and title kept',
    added.map((s) => s.text).join(' / '),
  );
  check(!added.some((s) => s.action === 'navigate'), 'no extra "Navigate to" step when the page is unchanged');
  await app.waitForSelector('[data-act="continue"]');
  check(!(await app.$('.recording-banner')), 'the open editor unlocks when the capture ends');
  await send({ type: 'start', tabId, guideId });
  await page.waitForSelector('flowdoc-recorder', { state: 'attached' });
  await page.click('#subject');
  await page.waitForTimeout(800);
  await send({ type: 'discard' });
  await page.waitForTimeout(500);
  const discarded = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
  check(discarded && !discarded.recording && JSON.stringify(snap(discarded)) === JSON.stringify(snap(continued)), 'Discard removes only the new steps and keeps the guide');

  // ---------- switching tabs while capturing ----------
  console.log('\nSwitching tabs');
  await page.bringToFront();
  const tabsGuide = (await send({ type: 'start', tabId })).guideId;
  await page.waitForSelector('flowdoc-recorder', { state: 'attached' });
  await page.click('#subject');
  await page.waitForTimeout(700);
  const other = await context.newPage();
  const otherUrl = `http://localhost:${PORT}/demo/index.html?tab=2`;
  await other.goto(otherUrl);
  await other.bringToFront();
  await other.waitForTimeout(1500);
  await page.bringToFront();
  await page.waitForTimeout(1500);
  await page.bringToFront(); // already on this page: no step
  await page.waitForTimeout(800);
  const tabsDone = context.waitForEvent('page');
  await send({ type: 'stop' });
  await (await tabsDone).close();
  await other.close();
  const switched = await app.evaluate((id) => window.flowdocApp.getGuide(id), tabsGuide);
  const navs = switched.steps.filter((s) => s.action === 'navigate').slice(1);
  console.log(`   ${switched.steps.map((s) => s.text).join(' / ')}`);
  check(navs[0]?.text === `Navigate to **${otherUrl}**` && navs[0].href === otherUrl && !!navs[0].screenshot, 'switching to another tab adds "Navigate to" with its link and a screenshot', navs[0]?.text);
  check(navs.length === 2 && navs[1].href === page.url(), 'switching back adds the first page again, once', navs.map((s) => s.href).join(' , '));
  await control.evaluate(async (id) => (await import('/shared/guides.js')).deleteGuide(id), tabsGuide);

  // ---------- repeated clicks ----------
  console.log('\nRepeated clicks');
  await page.bringToFront();
  await page.evaluate(() => {
    const add = (id, text, top, onclick) => {
      const b = document.createElement('button');
      b.id = id;
      b.textContent = text;
      b.style.cssText = `position:fixed;left:24px;top:${top}px;z-index:9;padding:8px 14px;background:#e2e8f0;color:#0f172a;border:1px solid #64748b;border-radius:6px;font:14px sans-serif;outline:none`;
      if (onclick) b.onclick = onclick;
      document.body.append(b);
    };
    add('noop', 'Refresh', 16);
    // The button keeps its name; only a small total next to it changes.
    const total = document.createElement('span');
    total.style.cssText = 'position:fixed;left:140px;top:72px;z-index:9;font:14px sans-serif';
    total.textContent = 'Total: 0';
    document.body.append(total);
    let n = 0;
    add('count', 'Add one', 64, () => (total.textContent = `Total: ${++n}`));
    // Like a user's guide: text left selected, then a code line clicked again
    // and again. Only the first click changes anything (the selection goes).
    const code = document.createElement('pre');
    code.id = 'code';
    code.textContent = 'npm test';
    code.style.cssText = 'position:fixed;left:24px;top:112px;z-index:9;margin:0;padding:8px 14px;background:#f1f5f9;color:#0f172a;font:14px monospace';
    const chosen = document.createElement('pre');
    chosen.id = 'chosen';
    chosen.textContent = 'npm run test:desktop';
    chosen.style.cssText = 'position:fixed;left:24px;top:160px;z-index:9;margin:0;padding:8px 14px;background:#f1f5f9;color:#0f172a;font:14px monospace';
    document.body.append(code, chosen);
  });
  // `plan`: selectors to click; "dbl:" double-clicks, "select:" selects that element's text.
  const recordClicks = async (plan) => {
    const id = (await send({ type: 'start', tabId })).guideId;
    await page.waitForSelector('flowdoc-recorder', { state: 'attached' });
    await page.waitForTimeout(600);
    for (const item of plan) {
      const [how, sel] = item.includes(':') ? item.split(/:(.*)/) : ['click', item];
      if (how === 'select') {
        await page.evaluate((s) => getSelection().selectAllChildren(document.querySelector(s)), sel);
        await page.waitForTimeout(300);
        continue;
      }
      if (how === 'dbl') await page.dblclick(sel);
      else await page.click(sel);
      await page.waitForTimeout(900);
    }
    await page.waitForTimeout(1800); // the last click, if held, settles on its own
    const done = context.waitForEvent('page');
    await send({ type: 'stop' });
    await (await done).close();
    const g = await app.evaluate((gid) => window.flowdocApp.getGuide(gid), id);
    await control.evaluate(async (gid) => (await import('/shared/guides.js')).deleteGuide(gid), id);
    return g.steps.filter((s) => s.action === 'click' || s.action === 'dblclick').map((s) => s.text);
  };
  const howMany = (list, re) => list.filter((t) => re.test(t)).length;
  const repOn = await recordClicks([
    '#noop', '#noop', '#noop',
    '#count', '#count', '#count',
    'select:#chosen', '#code', '#code', '#code',
    'dbl:#noop', 'dbl:#noop',
    '#count', 'dbl:#count',
  ]);
  check(howMany(repOn, /^Click \*\*Refresh/) === 1, 'clicking Refresh 3 times when nothing changes is one step', repOn.join(' / '));
  check(howMany(repOn, /Add one/) === 5, 'clicking "Add one" 3 times keeps 3 steps (each click changed something)', repOn.join(' / '));
  check(howMany(repOn, /npm test/) === 1, 'with text selected, clicking a line 3 times is one step: only the first click changed anything', repOn.join(' / '));
  check(howMany(repOn, /^Double-click \*\*Refresh/) === 1, 'double-clicking Refresh twice is one step', repOn.join(' / '));
  check(repOn.at(-2) === 'Click **Add one**' && repOn.at(-1) === 'Double-click **Add one**', 'a click then a double-click on the same thing are both kept', repOn.join(' / '));
  await control.evaluate(() => chrome.storage.local.set({ flowdoc_capture: { ignoreRepeats: false } }));
  const repOff = await recordClicks(['#noop', '#noop']);
  check(howMany(repOff, /Refresh/) === 2, 'with the setting off, every click is a step again', repOff.join(' / '));
  await control.evaluate(() => chrome.storage.local.remove('flowdoc_capture'));

  // A double-click is one step whose screenshot is taken at the first press;
  // the second press takes none. Screenshots are counted where they are taken.
  {
    await worker.evaluate(() => {
      self.__flowdocShots = 0;
      if (!self.__flowdocCapture) {
        self.__flowdocCapture = chrome.tabs.captureVisibleTab.bind(chrome.tabs);
        chrome.tabs.captureVisibleTab = (...args) => {
          self.__flowdocShots++;
          return self.__flowdocCapture(...args);
        };
      }
    });
    const id = (await send({ type: 'start', tabId })).guideId;
    await page.waitForSelector('flowdoc-recorder', { state: 'attached' });
    await page.waitForTimeout(1200);
    const stepsOf = async () => (await control.evaluate(async (gid) => (await import('/shared/guides.js')).getGuide(gid), id)).steps;
    const before = await stepsOf();
    const shotsBefore = await worker.evaluate(() => self.__flowdocShots);
    await page.dblclick('#count');
    await page.waitForTimeout(2200);
    const after = await stepsOf();
    const shots = (await worker.evaluate(() => self.__flowdocShots)) - shotsBefore;
    const added = after.slice(before.length);
    const done = context.waitForEvent('page');
    await send({ type: 'stop' });
    await (await done).close();
    await control.evaluate(async (gid) => (await import('/shared/guides.js')).deleteGuide(gid), id);
    const summary = JSON.stringify({ added: added.map((st) => `${st.action}: ${st.text}${st.screenshot ? ' [shot]' : ''}`), shots });
    check(added.length === 1 && added[0].action === 'dblclick' && /^Double-click \*\*Add one/.test(added[0].text), 'a double-click adds exactly one step (no separate click step)', summary);
    check(!!added[0]?.screenshot && shots === 1, 'the second press of a double-click takes no screenshot of its own', summary);
  }

  // ---------- copy menu ----------
  console.log('\nCopy as text or Markdown');
  await app.bringToFront();
  await app.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = async (t) => void window.__copied.push(t);
  });
  const copyItems = [];
  for (const i of [0, 1, 2]) {
    await app.click('[data-act="copy"]');
    await app.waitForSelector('.menu [role="menuitem"]');
    copyItems.push(await app.locator('.menu [role="menuitem"]').nth(i).textContent());
    await app.locator('.menu [role="menuitem"]').nth(i).click();
    await app.waitForFunction((n) => window.__copied.length === n, i + 1);
  }
  const [asText, mdWithImages, mdPlain] = await app.evaluate(() => window.__copied);
  check(copyItems.join(' | ') === 'Text | Markdown with images | Markdown without images', 'Copy offers Text, Markdown with images and without', copyItems.join(' | '));
  check(/^\S.*\n\n1\. /s.test(asText) && !asText.includes('!['), 'Text copies the numbered steps');
  const embedded = mdWithImages.match(/!\[Step \d+\]\(data:image\/[a-z]+;base64,/g) || [];
  check(mdWithImages.startsWith('# ') && embedded.length >= 3, 'Markdown with images has the screenshots inside the text', `${embedded.length} images, ${Math.round(mdWithImages.length / 1024)} KB`);
  check(mdPlain.startsWith('# ') && /### 1\. /.test(mdPlain) && !mdPlain.includes('!['), 'Markdown without images has the steps and no images', `${Math.round(mdPlain.length / 1024)} KB`);
  await app.evaluate(() => window.scrollTo(0, 0));
  await app.click('[data-act="copy"]');
  await app.waitForSelector('.menu [role="menuitem"]');
  await app.screenshot({ path: join(out, 'editor-copy-menu.png') });
  await app.keyboard.press('Escape');

  // ---------- AI in the extension: settings, Translate, Improve ----------
  console.log('\nAI (Translate and Improve)');
  // A stand-in for Gemini, answering the extension's requests in the page.
  const aiCalls = [];
  await context.route('https://generativelanguage.googleapis.com/**', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const prompt = body.contents?.[0]?.parts?.find((p) => p.text)?.text || '';
    aiCalls.push({ key: route.request().headers()['x-goog-api-key'], translate: prompt.startsWith('Translate these'), images: (body.contents?.[0]?.parts || []).filter((p) => p.inline_data).length });
    let answer = {};
    if (prompt.startsWith('Translate these')) {
      answer = { items: [...prompt.matchAll(/^\[(\d+)\] \((.*?)\) (.*)$/gm)].map(([, i, , t]) => ({ i: Number(i), text: `हिन्दी: ${t}` })) };
    } else if (prompt.includes('Draft: ')) {
      answer = { steps: [...prompt.matchAll(/^\[(\d+)\] \(.*?\) Draft: (.*)$/gm)].map(([, i, d]) => ({ i: Number(i), text: `${d} ✓`, note: '' })) };
    } else if (prompt.includes('Write a title')) {
      answer = { title: 'How to open a support ticket (AI)', description: 'Sign in and file a ticket.' };
    } else if (prompt.includes('Return {"ok": true}')) answer = { ok: true };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) });
  });
  await app.goto(`chrome-extension://${extId}/app.html#/guide/${guideId}`);
  await app.waitForSelector('[data-act="translate"]');
  const trBtn = () => app.evaluate(() => { const b = document.querySelector('[data-act="translate"]'); return { needsAi: b.classList.contains('needs-ai'), improve: !!document.querySelector('[data-act="ai"]') }; });
  const before = await trBtn();
  check(before.needsAi && !before.improve, 'without a key: Translate is greyed out, Improve is hidden');
  await app.click('[data-act="translate"]', { force: true }); // aria-disabled, but clickable on purpose
  await app.waitForSelector('dialog .needs-ai');
  check((await app.locator('dialog .needs-ai h2').textContent()) === 'Translation needs AI', 'clicking it explains that AI is needed');
  await app.click('dialog .needs-ai [data-act="settings"]');
  await app.waitForSelector('dialog .settings #aiProvider');
  const tabs = await app.evaluate(() => ({ all: [...document.querySelectorAll('dialog [role="tab"]')].map((b) => b.dataset.tab), on: document.querySelector('dialog [aria-selected="true"]')?.dataset.tab }));
  check(JSON.stringify(tabs.all) === '["general","capture","ai","integrations"]' && tabs.on === 'ai', 'extension Settings has General, Capture, AI and Integrations; "Open AI settings" lands on AI', JSON.stringify(tabs));
  const side = await app.evaluate(() => {
    const nav = document.querySelector('dialog .settings-tabs');
    const n = nav.getBoundingClientRect();
    const b = document.querySelector('dialog .settings-body').getBoundingClientRect();
    return { orientation: nav.getAttribute('aria-orientation'), left: n.right <= b.left + 1, vertical: getComputedStyle(nav).flexDirection === 'column' };
  });
  check(side.orientation === 'vertical' && side.left && side.vertical, 'the sections are in a sidebar left of the settings', JSON.stringify(side));
  const sections = await app.evaluate(() => [...document.querySelectorAll('dialog .settings h3')].map((h) => h.textContent.trim()));
  check(!sections.some((s) => /Guides folder|While capturing|Typed text/.test(s)) && sections.some((s) => s.startsWith('AI assistant')) && sections.some((s) => s.startsWith('Notion')), 'extension settings show only what applies there (Notion included)', sections.join(', '));
  const capture = await app.evaluate(() => ({
    boxes: [...document.querySelectorAll('dialog .settings input[type="checkbox"]')].map((c) => c.name),
    ignoreRepeats: document.querySelector('dialog .settings [name="ignoreRepeats"]')?.checked,
  }));
  check(JSON.stringify(capture.boxes) === '["ignoreRepeats"]' && capture.ignoreRepeats === true, 'Capture has only "Ignore repeated clicks that change nothing", ticked by default', JSON.stringify(capture));
  check(/browser profile only.*encrypted/.test(await app.locator('dialog .settings .sub').first().textContent()), 'settings say where the key is kept, and that it is encrypted');
  await app.selectOption('dialog .settings #aiProvider', 'gemini');
  await app.fill('dialog .settings #aiKey', 'test-extension-key');
  await app.click('dialog .settings [data-act="saveKey"]');
  await app.waitForSelector('dialog .settings [data-act="removeKey"]:not([hidden])');
  await app.click('dialog .settings [data-act="test"]');
  await app.waitForFunction(() => /Connected/.test(document.querySelector('dialog .settings .test-result')?.textContent || ''));
  check(true, 'key saved and Test connection works from the extension');
  await app.screenshot({ path: join(out, 'extension-ai-settings.png') });
  await app.click('dialog .settings [data-close]');
  await app.waitForFunction(() => !document.querySelector('[data-act="translate"]')?.classList.contains('needs-ai'));
  check((await trBtn()).improve, 'with a key: Translate is active and Improve with AI appears');

  // Polls storage until the guide passes `ok` (waitForFunction can't await).
  const waitGuide = async (id, ok, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await app.waitForTimeout(250)) {
      const g = await app.evaluate((gid) => window.flowdocApp.getGuide(gid), id);
      if (g && ok(g)) return g;
    }
    return app.evaluate((gid) => window.flowdocApp.getGuide(gid), id);
  };
  const original = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
  await app.click('[data-act="translate"]');
  await app.waitForSelector('dialog .translate');
  await app.selectOption('dialog .translate [name="language"]', 'hi');
  await app.screenshot({ path: join(out, 'extension-translate-dialog.png') });
  await app.click('dialog .translate .go');
  await app.waitForFunction((id) => !location.hash.endsWith(id), guideId);
  const copyId = app.url().split('/').pop();
  const hindi = await waitGuide(copyId, (g) => g.title.startsWith('हिन्दी: '));
  const after = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
  const numberedHindi = hindi.steps.filter((s) => s.kind === 'action' || s.kind === 'manual');
  check(hindi.language?.code === 'hi' && JSON.stringify(after.steps) === JSON.stringify(original.steps), 'Hindi copy made; the original is unchanged', hindi.title);
  check(numberedHindi.every((s) => s.text.startsWith('हिन्दी: ')), 'every step translated', `${numberedHindi.length} steps`);
  check(aiCalls.some((c) => c.translate && c.key === 'test-extension-key' && c.images === 0), 'requests go to Gemini with the saved key, text only');
  await app.screenshot({ path: join(out, 'extension-translated.png') });

  await app.goto(`chrome-extension://${extId}/app.html#/guide/${guideId}`);
  await app.waitForSelector('[data-act="ai"]');
  await app.click('[data-act="ai"]');
  await app.waitForSelector('dialog .improve');
  await app.click('dialog .improve label.style-card:has(input[value="crisp"])');
  await app.click('dialog .improve .go');
  const improved = await waitGuide(guideId, (g) => g.title === 'How to open a support ticket (AI)');
  check(improved.steps.filter((s) => s.kind === 'action').every((s) => s.text.endsWith('✓')), 'Improve with AI works in the extension', improved.title);

  // ---------- secrets are stored encrypted ----------
  console.log('\nEncrypted keys');
  const rawKeys = () => app.evaluate(async () => (await chrome.storage.local.get('flowdoc_ai_keys')).flowdoc_ai_keys || {});
  const sealedShape = (v) => !!v && typeof v === 'object' && v.v === 1 && typeof v.iv === 'string' && typeof v.data === 'string';
  const unsealRaw = (v) => app.evaluate(async (val) => (await import('./shared/secretStore.js')).unseal(val), v);
  let raw = await rawKeys();
  check(sealedShape(raw.gemini) && !JSON.stringify(raw).includes('test-extension-key'), 'the AI key is stored encrypted, never as text', JSON.stringify(raw.gemini).slice(0, 80));
  check((await unsealRaw(raw.gemini)) === 'test-extension-key', 'and decrypts back to the key that was pasted');
  const ivs = await app.evaluate(async () => {
    const { seal } = await import('./shared/secretStore.js');
    const [a, b] = [await seal('same text'), await seal('same text')];
    return { differ: a.iv !== b.iv && a.data !== b.data };
  });
  check(ivs.differ, 'the same text encrypts differently every time (fresh IV)');
  const keyInfo = await app.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('flowdoc-secrets');
        req.onsuccess = () => {
          const get = req.result.transaction('keys').objectStore('keys').get('aes-gcm-1');
          get.onsuccess = async () => {
            const k = get.result;
            let exported = 'exported';
            try {
              await crypto.subtle.exportKey('raw', k);
            } catch (e) {
              exported = e.name;
            }
            resolve({ type: k?.type, algorithm: k?.algorithm?.name, length: k?.algorithm?.length, extractable: k?.extractable, exported });
          };
        };
      }),
  );
  check(keyInfo.algorithm === 'AES-GCM' && keyInfo.length === 256 && keyInfo.extractable === false && keyInfo.exported === 'InvalidAccessError', 'the key is AES-GCM 256, kept apart in IndexedDB, and cannot be read out', JSON.stringify(keyInfo));
  const tampered = await app.evaluate(async (v) => {
    const { unseal } = await import('./shared/secretStore.js');
    const bytes = Uint8Array.from(atob(v.data), (c) => c.charCodeAt(0));
    bytes[0] ^= 1;
    try {
      await unseal({ ...v, data: btoa(String.fromCharCode(...bytes)) });
      return 'decrypted';
    } catch (e) {
      return e.message;
    }
  }, raw.gemini);
  check(/could not be decrypted/.test(tampered), 'a changed byte makes decryption fail (no wrong key handed out)', tampered);
  // A key saved as text by an older version is encrypted when the workspace opens.
  await app.evaluate(async () => {
    const keys = (await chrome.storage.local.get('flowdoc_ai_keys')).flowdoc_ai_keys || {};
    await chrome.storage.local.set({ flowdoc_ai_keys: { ...keys, groq: 'plain-groq-key' } });
  });
  await app.goto(`chrome-extension://${extId}/app.html#/`);
  await app.reload(); // a fresh workspace, as when it is opened again
  await app.waitForSelector('.card');
  await app.evaluate(async () => (await import('./app/aiHost.js')).aiHost.settings.get());
  raw = await rawKeys();
  check(sealedShape(raw.groq) && !JSON.stringify(raw).includes('plain-groq-key') && (await unsealRaw(raw.groq)) === 'plain-groq-key', 'a key saved as text before is encrypted on first open, and still works', JSON.stringify(raw.groq).slice(0, 60));

  // ---------- Notion in the extension ----------
  console.log('\nNotion');
  const { notion: nmock, handle: notionHandle } = createNotionMock();
  await context.route('https://api.notion.com/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const { status, data } = notionHandle({ method: req.method(), url: u.pathname + u.search, headers: await req.allHeaders(), body: req.postDataBuffer() });
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await app.goto(`chrome-extension://${extId}/app.html#/guide/${guideId}`);
  await app.waitForSelector('[data-act="notion"]');
  check(true, 'the guide toolbar has a Notion button');
  // Connect in Settings → Integrations.
  await app.evaluate(() => document.querySelector('.settings-btn').click());
  await app.waitForSelector('dialog .settings [data-tab="integrations"]');
  await app.click('dialog .settings [data-tab="integrations"]');
  await app.fill('dialog .settings #notionToken', 'ntn_ext_secret');
  await app.click('dialog .settings [data-act="saveNotion"]');
  await app.waitForFunction(() => /Connected to/.test(document.querySelector('dialog .notion-result')?.textContent || ''));
  check(/Avinash Workspace · 1 page/.test(await app.locator('dialog .notion-result').textContent()), 'Settings → Integrations: Save and Test connection reach Notion', await app.locator('dialog .notion-result').textContent());
  await app.screenshot({ path: join(out, 'extension-notion-settings.png') });
  await app.click('dialog .settings [data-close]');
  raw = await rawKeys();
  check(sealedShape(raw.notion) && !JSON.stringify(raw).includes('ntn_ext_secret') && (await unsealRaw(raw.notion)) === 'ntn_ext_secret', 'the Notion secret is stored encrypted');

  const nrows = () => app.evaluate(() => [...document.querySelectorAll('dialog .tree .node .title')].map((n) => n.textContent));
  const waitNRows = async (expected) => {
    for (const end = Date.now() + 15000; Date.now() < end; await app.waitForTimeout(150)) if (JSON.stringify(await nrows()) === JSON.stringify(expected)) return expected;
    return nrows();
  };
  const clickNRow = (title) => app.evaluate((t) => [...document.querySelectorAll('dialog .tree .node')].find((n) => n.querySelector('.title').textContent === t)?.click(), title);
  const nPath = () => app.evaluate(() => document.querySelector('dialog .selected-path b')?.textContent || '');
  const openNotion = async () => {
    await app.click('[data-act="notion"]');
    await app.waitForSelector('dialog .notion .who b');
  };
  const FULL = 'Team wiki / How-tos / AWS Trial / some_topic / some_topic_2';
  await openNotion();
  const nroots = await waitNRows(['Team wiki']);
  check(JSON.stringify(nroots) === '["Team wiki"]', 'Save to Notion lists the shared pages (database rows skipped)', JSON.stringify(nroots));
  for (const [title, next] of [['Team wiki', ['How-tos', 'Archive']], ['How-tos', ['AWS Trial']], ['AWS Trial', ['some_topic']], ['some_topic', ['some_topic_2']]]) {
    await clickNRow(title);
    await waitNRows(next);
  }
  await clickNRow('some_topic_2');
  await app.waitForFunction(() => (document.querySelector('dialog .tree .empty-tree')?.textContent || '').includes('No subpages'));
  check((await nPath()) === FULL, 'browsing 5 levels deep (through columns and toggles) sets the destination', await nPath());
  await app.click('dialog [data-act="star"]');
  await app.fill('dialog [name="locName"]', 'AWS LEARNING');
  await app.click('dialog [data-act="saveLoc"]');
  await app.waitForSelector('dialog .chip-go');
  check((await app.locator('dialog .chip-go').first().textContent()) === '★ AWS LEARNING', 'a location can be saved with a name');
  await app.screenshot({ path: join(out, 'extension-notion-picker.png') });
  await app.click('dialog [data-act="save"]');
  await app.waitForSelector('dialog .done:not([hidden])', { timeout: 30000 });
  await app.screenshot({ path: join(out, 'extension-notion-done.png') });
  const nshots = (await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId)).steps.filter((s) => s.screenshot && !s.hideImage).length;
  const npage = nmock.pages[0] || {};
  const nblocks = npage.children || [];
  check(npage.parent?.page_id === 'p-topic2' && nblocks.some((b) => b.type === 'heading_3'), 'the guide is created as a page inside the chosen subpage', npage.parent?.page_id);
  check(nmock.uploads === nshots && nmock.sent.length === nshots && nmock.sent.every((x) => x.multipart && x.bytes > 2000), 'each screenshot is uploaded to Notion as a file', `${nmock.sent.length}/${nshots}`);
  check(nblocks.filter((b) => b.type === 'image').length === nshots, 'image blocks reference the uploaded screenshots');
  check(nmock.calls.length > 0 && nmock.calls.every((c) => c.version === '2026-03-11' && c.auth === 'Bearer ntn_ext_secret'), 'every Notion call sends the version header and the decrypted secret', `${nmock.calls.length} calls`);
  const stored = await (async () => {
    for (const end = Date.now() + 5000; Date.now() < end; await app.waitForTimeout(200)) {
      const g = await app.evaluate((id) => window.flowdocApp.getGuide(id), guideId);
      if (g.notion?.url) return g.notion;
    }
    return null;
  })();
  check(stored?.url === 'https://www.notion.so/page-new' && stored.parentPath === FULL, 'the Notion link is kept on the guide', JSON.stringify(stored));
  await app.click('dialog [data-act="cancel"]');

  // Next time: starts at the last destination (Recent), and can replace the copy.
  await openNotion();
  for (const end = Date.now() + 15000; Date.now() < end && !(await nPath()).endsWith('some_topic_2'); ) await app.waitForTimeout(150);
  const nrecent = await app.evaluate(() => [...document.querySelectorAll('dialog .recent-row')].map((r) => r.textContent));
  check((await nPath()) === FULL && nrecent[0] === FULL, 'reopening starts at the last destination, listed under Recent', JSON.stringify(nrecent));
  check(await app.locator('dialog [name="replace"]').isVisible(), 'it offers to replace the copy saved last time');
  await app.check('dialog [name="replace"]');
  await app.click('dialog [data-act="save"]');
  await app.waitForSelector('dialog .done:not([hidden])', { timeout: 30000 });
  check(nmock.pages.length === 2 && JSON.stringify(nmock.trashed) === '["page-new"]', 'Replace moves the previous copy to Notion\'s trash', JSON.stringify(nmock.trashed));
  // Catch the new tab instead of opening the real Notion site.
  await app.evaluate(() => {
    window.__opened = [];
    chrome.tabs.create = (opts) => window.__opened.push(opts.url);
  });
  await app.click('dialog [data-act="open"]');
  const opened = await app.evaluate(() => window.__opened);
  check(JSON.stringify(opened) === '["https://www.notion.so/page-new-2"]', 'Open in Notion opens the new page in a tab', JSON.stringify(opened));
  await app.click('dialog [data-act="cancel"]');
  // Later, from the guide's ⋯ menu, using the link kept on the guide.
  await app.waitForFunction(async (id) => (await window.flowdocApp.getGuide(id)).notion?.url?.endsWith('page-new-2'), guideId);
  await app.click('[data-act="more"]');
  await app.click('.menu [role="menuitem"]:has-text("Open in Notion")');
  const fromMenu = await app.evaluate(() => window.__opened);
  check(fromMenu.at(-1) === 'https://www.notion.so/page-new-2' && fromMenu.length === 2, '⋯ → Open in Notion opens the saved page later', JSON.stringify(fromMenu));

  // Disconnect removes the secret.
  await app.evaluate(() => document.querySelector('.settings-btn').click());
  await app.waitForSelector('dialog .settings [data-act="disconnectNotion"]');
  await app.click('dialog .settings [data-tab="integrations"]');
  await app.click('dialog .settings [data-act="disconnectNotion"]');
  await app.waitForFunction(() => /Disconnected/.test(document.querySelector('dialog .notion-result')?.textContent || ''));
  check(!('notion' in (await rawKeys())), 'Disconnect removes the Notion secret');
  await app.click('dialog .settings [data-close]');

  // ---------- library ----------
  await app.goto(`chrome-extension://${extId}/app.html#/`);
  await app.waitForSelector('.card');
  check((await app.locator('.card').count()) === 2, 'guide and its translation listed in the library');
  await app.screenshot({ path: join(out, 'library.png') });

  // ---------- popup ----------
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 460 });
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForSelector('#recent li');
  await popup.screenshot({ path: join(out, 'popup.png') });
  check((await popup.locator('#recent li').count()) === 2, 'popup lists recent guides');
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
