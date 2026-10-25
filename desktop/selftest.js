// Desktop self-test (FLOWDOC_SELFTEST=1). Opens the demo site in a window,
// feeds the recorder synthetic hook events at real element positions (so
// screen capture and the accessibility inspector run for real, without moving
// the user's mouse), exercises AI enhancement against a mock server, runs the
// exporters inside the workspace, and writes results.json for the runner.
import { BrowserWindow, nativeTheme, screen } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import uiohookPkg from 'uiohook-napi';
import { getGuide, saveGuide } from '../extension/shared/guides.js';
import { createSettings } from './settings.js';
import { folderUsable } from './store.js';

const { uIOhook, UiohookKey: K } = uiohookPkg;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (msg) => console.log(`[selftest] ${msg}`);
const within = (promise, ms) => Promise.race([promise, sleep(ms)]);

export async function runSelfTest({ app, mainWin, recorder, startRecording, settings, markCapturable, getWidget }) {
  const out = process.env.FLOWDOC_TEST_OUT;
  mkdirSync(out, { recursive: true });
  const results = { checks: {}, notes: [] };
  const shot = async (win, name) => writeFileSync(join(out, name), (await win.webContents.capturePage()).toPNG());

  // Exports from the workspace go straight to the output folder.
  mainWin.webContents.session.on('will-download', (_e, item) => item.setSavePath(join(out, item.getFilename())));
  await new Promise((r) => (mainWin.webContents.isLoading() ? mainWin.webContents.once('did-finish-load', r) : r()));

  // The global hook itself: make sure the native module starts and stops.
  try {
    uIOhook.start();
    await sleep(200);
    uIOhook.stop();
    results.checks.hookLoads = true;
  } catch (err) {
    results.checks.hookLoads = false;
    results.notes.push(`uiohook: ${err.message}`);
  }

  // ---------- demo window ----------
  const area = screen.getPrimaryDisplay().workArea;
  const demo = new BrowserWindow({
    width: Math.min(1100, area.width - 40),
    height: Math.min(760, area.height - 40),
    x: area.x + 20,
    y: area.y + 20,
    title: 'Northwind Support (FlowDoc self-test)',
    autoHideMenuBar: true,
    alwaysOnTop: true,
  });
  markCapturable(demo);
  await demo.loadURL('app://flowdoc/demo/index.html');
  demo.focus();
  await sleep(1200);

  const win32 = process.platform === 'win32';
  const toPhysical = (p) => (win32 ? screen.dipToScreenPoint(p) : p);
  async function centerOf(selector) {
    const r = await demo.webContents.executeJavaScript(
      `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    const cb = demo.getContentBounds();
    return { css: r, dip: { x: cb.x + r.x, y: cb.y + r.y } };
  }
  async function click(selector, { button = 1, clicks = 1 } = {}) {
    const { css, dip } = await centerOf(selector);
    const phys = toPhysical({ x: Math.round(dip.x), y: Math.round(dip.y) });
    recorder.simulate.mousedown({ x: phys.x, y: phys.y, button, clicks });
    await sleep(60); // the real click lands after the hook fired, as with a person
    const btn = button === 2 ? 'right' : 'left';
    demo.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(css.x), y: Math.round(css.y), button: btn, clickCount: clicks });
    demo.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(css.x), y: Math.round(css.y), button: btn, clickCount: clicks });
    await sleep(700);
  }
  const KEYS = Object.fromEntries('abcdefghijklmnopqrstuvwxyz'.split('').map((c) => [c, K[c.toUpperCase()]]));
  Object.assign(KEYS, { ' ': K.Space, '@': K[2], '.': K.Period, '0': K[0], '1': K[1], '2': K[2], '3': K[3], '4': K[4], '5': K[5], '6': K[6], '7': K[7], '8': K[8], '9': K[9] });
  // Typing steps ask Windows which field has keyboard focus, so the demo
  // window must really be in front. Windows refuses plain focus() while the
  // user is busy in another app; minimise + restore is allowed.
  results.checks.demoFocused = true;
  async function focusDemo() {
    for (let attempt = 0; attempt < 3 && !demo.isFocused(); attempt++) {
      demo.minimize();
      await sleep(150);
      demo.restore();
      demo.focus();
      demo.webContents.focus();
      await sleep(300);
    }
    if (!demo.isFocused()) results.checks.demoFocused = false;
  }
  async function type(text) {
    await focusDemo();
    for (const ch of text) {
      const shift = ch === '@' || /[A-Z]/.test(ch);
      recorder.simulate.keydown({ keycode: KEYS[ch.toLowerCase()], shiftKey: shift, ctrlKey: false, altKey: false, metaKey: false });
      demo.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      await sleep(25);
    }
  }
  const key = (keycode, mods = {}) => recorder.simulate.keydown({ keycode, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, ...mods });

  // ---------- record ----------
  progress('recording');
  // Regression: AI must never start on its own when a capture ends, even with
  // AI set up and an old "improve automatically" value left in the settings.
  await settings.update({ ai: { provider: 'gemini', models: { gemini: 'gemini-3.6-flash' }, autoEnhance: true } });
  await settings.setKey('gemini', 'test-gemini-key');
  await startRecording({});

  // Recorder bar: buttons must sit outside the window-drag region (on Windows
  // a drag region swallows clicks), and pressing them must drive the recorder.
  const widget = getWidget();
  await sleep(600);
  results.widget = await widget.webContents.executeJavaScript(`(() => {
    const region = (el) => getComputedStyle(el).getPropertyValue('app-region') || getComputedStyle(el).webkitAppRegion;
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width }; };
    return {
      grip: region(document.querySelector('.grip')),
      buttons: ['toggle', 'discard', 'done'].map((id) => region(document.getElementById(id))),
      fits: document.getElementById('bar').getBoundingClientRect().width <= window.innerWidth,
      toggle: r('toggle'), done: r('done'),
    };
  })()`);
  const press = async (pt) => {
    widget.webContents.sendInputEvent({ type: 'mouseDown', x: Math.round(pt.x), y: Math.round(pt.y), button: 'left', clickCount: 1 });
    widget.webContents.sendInputEvent({ type: 'mouseUp', x: Math.round(pt.x), y: Math.round(pt.y), button: 'left', clickCount: 1 });
    await sleep(500);
  };
  await press(results.widget.toggle);
  results.widget.pausedAfterClick = recorder.state.paused;
  await press(results.widget.toggle);
  results.widget.resumedAfterClick = !recorder.state.paused;

  await click('#email');
  await type('alex@northwind.example');
  await sleep(2600); // typing pause -> step is written
  await click('#password');
  await type('hunter22');
  await sleep(2600);
  await click('#remember');
  const navigated = new Promise((r) => demo.webContents.once('did-finish-load', r));
  await click('button[type=submit]');
  if ((await within(navigated.then(() => true), 6000)) !== true) {
    results.notes.push('submit click did not navigate; loading ticket page directly');
    await demo.loadURL('app://flowdoc/demo/ticket.html');
  }
  progress('second page');
  await sleep(900);
  await click('#subject');
  await type('Printer offline');
  key(K.Enter);
  await sleep(900);
  await click('h1', { clicks: 1 });
  await click('h1', { clicks: 2 });
  await click('#details', { button: 2 });
  key(K.S, { ctrlKey: true });
  await sleep(1200);
  await recorder.drain();
  progress('stopping');
  // Finish with the bar's Done button, like a user would.
  const guideId = recorder.state.guideId;
  const finished = new Promise((r) => recorder.events.once('finished', r));
  await press(results.widget.done);
  results.widget.doneStopped = (await within(finished.then(() => true), 15000)) === true;
  if (!results.widget.doneStopped) await recorder.stop();
  demo.destroy();
  await sleep(1500);
  results.afterCapture = await mainWin.webContents.executeJavaScript(`({
    guideOpen: location.hash === '#/guide/${guideId}',
    aiDialog: !!document.querySelector('dialog .improve'),
    aiBanner: !!document.querySelector('.ai-banner'),
  })`);
  results.afterCapture.autoSettingKept = 'autoEnhance' in (await settings.get()).ai;

  const guide = await getGuide(guideId);
  results.guide = {
    title: guide.title,
    steps: guide.steps.map((s) => ({
      text: s.text,
      action: s.action,
      app: s.app,
      window: s.window,
      hasShot: !!s.screenshot,
      shot: s.shot,
      target: s.target,
      click: s.click,
      secret: s.secret,
      value: s.value,
    })),
  };
  results.rawContainsPassword = JSON.stringify(guide).includes('hunter22');
  await shot(mainWin, 'desktop-editor.png');

  // ---------- AI enhancement against the mock providers ----------
  const js = (code) => mainWin.webContents.executeJavaScript(code);
  const waitFor = async (check, ms = 30000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const v = await check();
      if (v) return v;
      await sleep(300);
    }
    return null;
  };
  const openGuide = async () => {
    await js(`location.hash = '#/guide/${guideId}'; window.flowdocApp.route()`);
    await sleep(700);
  };
  const runAi = async (provider, apiKey, model, style) => {
    await settings.update({ ai: { provider, models: { [provider]: model }, style } });
    await settings.setKey(provider, apiKey);
    await openGuide();
    await js(`window.flowdocApp.runAiImprove(true)`);
    return (await waitFor(async () => {
      const g = await getGuide(guideId);
      return g.title.includes(`(${provider}, ${style})`) && g;
    })) || getGuide(guideId);
  };
  const summarize = (g) => ({
    title: g.title,
    description: g.description,
    steps: g.steps.filter((s) => s.kind !== 'heading').map((s) => s.text),
    notes: g.steps.filter((s) => s.note).length,
    headings: g.steps.filter((s) => s.kind === 'heading').map((s) => s.text),
  });

  progress('ai: gemini elaborate');
  results.ai = { gemini: summarize(await runAi('gemini', 'test-gemini-key', 'gemini-3.6-flash', 'elaborate')) };
  await shot(mainWin, 'desktop-after-ai.png');
  progress('ai: gemini crisp');
  results.ai.crisp = summarize(await runAi('gemini', 'test-gemini-key', 'gemini-3.6-flash', 'crisp'));
  progress('ai: gemini conceptual');
  results.ai.conceptual = summarize(await runAi('gemini', 'test-gemini-key', 'gemini-3.6-flash', 'conceptual'));
  await shot(mainWin, 'desktop-after-conceptual.png');

  // Background job: the Groq mock answers slowly. Start, watch progress, close
  // the dialog, go back to the guide list — the result must still be applied.
  progress('ai: groq in background');
  await settings.update({ ai: { provider: 'groq', models: { groq: 'qwen/qwen3.8-27b' }, style: 'elaborate' } });
  await settings.setKey('groq', 'test-groq-key');
  await openGuide();
  await js(`window.flowdocApp.runAiImprove(true)`);
  await sleep(1200);
  results.background = await js(`({
    dialogProgress: !document.querySelector('dialog .progress')?.hidden,
    status: document.querySelector('dialog .status')?.textContent || '',
    banner: !!document.querySelector('.ai-banner'),
    sidebarMark: [...document.querySelectorAll('#recentNav a')].some((a) => a.textContent.startsWith('✨')),
  })`);
  await shot(mainWin, 'desktop-ai-progress.png');
  await js(`document.querySelector('dialog [data-act="close"]').click(); location.hash = '#/';`);
  const afterGroq = await waitFor(async () => {
    const g = await getGuide(guideId);
    return g.title.includes('(groq, elaborate)') && g;
  }, 60000);
  results.background.appliedWhileAway = !!afterGroq;
  results.ai.groq = summarize(afterGroq || (await getGuide(guideId)));

  // ---------- model picker ----------
  progress('settings: models + theme');
  await settings.update({ ai: { provider: 'gemini' } });
  await js(`document.querySelector('.settings-btn').click()`);
  await sleep(600);
  await js(`document.querySelector('dialog [data-act="models"]').click()`);
  results.models = await waitFor(() =>
    js(`(() => {
      const opts = [...document.querySelectorAll('dialog select[name="model"] option')].map((o) => o.value);
      return opts.length > 4 ? opts : null;
    })()`),
  );
  await shot(mainWin, 'desktop-settings.png');

  // ---------- theme ----------
  results.theme = {};
  for (const mode of ['dark', 'light']) {
    await js(`window.flowdocTheme.set('${mode}')`);
    await sleep(500);
    results.theme[mode] = { html: await js(`document.documentElement.dataset.theme`), native: nativeTheme.themeSource, saved: (await settings.get()).ui.theme };
    await shot(mainWin, `desktop-settings-${mode}.png`);
  }
  await js(`document.querySelector('dialog [data-close]').click()`);
  await sleep(300);
  await js(`window.flowdocTheme.set('dark')`);
  await openGuide();
  await shot(mainWin, 'desktop-editor-dark.png');
  await js(`window.flowdocTheme.set('system')`);
  results.theme.system = { native: nativeTheme.themeSource };

  // ---------- Save to Notion (mock) ----------
  progress('notion');
  await settings.setKey('notion', 'ntn_test_secret');
  await openGuide();
  results.notion = {};
  const rows = () => js(`[...document.querySelectorAll('dialog .tree .node .title')].map((n) => n.textContent)`);
  const waitRows = async (expected) =>
    waitFor(async () => {
      const r = await rows();
      return JSON.stringify(r) === JSON.stringify(expected) ? r : null;
    }, 15000);
  const clickRow = (title) =>
    js(`[...document.querySelectorAll('dialog .tree .node')].find((n) => n.querySelector('.title').textContent === ${JSON.stringify(title)})?.click()`);
  const selectedPath = () => js(`document.querySelector('dialog .selected-path b')?.textContent || ''`);
  const openNotion = async () => {
    await js(`document.querySelector('[data-act="notion"]').click()`);
    await waitFor(() => js(`!!document.querySelector('dialog .notion .who b')`), 15000);
  };

  // Browse down like folders. Search only knows the top page (as real Notion
  // often does); subpages come from each page's own children.
  await openNotion();
  results.notion.roots = await waitRows(['Team wiki']);
  await clickRow('Team wiki');
  results.notion.level1 = await waitRows(['How-tos', 'Archive']);
  await clickRow('How-tos');
  results.notion.level2 = await waitRows(['AWS Trial']);
  await clickRow('AWS Trial');
  await waitRows(['some_topic']);
  await clickRow('some_topic');
  await waitRows(['some_topic_2']);
  await clickRow('some_topic_2');
  await waitFor(() => js(`(document.querySelector('dialog .tree .empty-tree')?.textContent || '').includes('No subpages')`));
  results.notion.path = await selectedPath();
  results.notion.crumbs = await js(`[...document.querySelectorAll('dialog .crumbs .crumb')].map((c) => c.textContent)`);
  // Name this place.
  await js(`document.querySelector('dialog [data-act="star"]').click()`);
  await js(`(() => { const i = document.querySelector('dialog [name="locName"]'); i.value = 'AWS LEARNING'; document.querySelector('dialog [data-act="saveLoc"]').click(); })()`);
  results.notion.chips = await waitFor(() => js(`(() => { const c = [...document.querySelectorAll('dialog .chip-go')].map((x) => x.textContent); return c.length ? c : null; })()`));
  await shot(mainWin, 'desktop-notion-picker.png');
  await js(`document.querySelector('dialog [data-act="save"]').click()`);
  results.notion.done = !!(await waitFor(() => js(`!document.querySelector('dialog .done')?.hidden`), 30000));
  await shot(mainWin, 'desktop-notion-done.png');
  await js(`document.querySelector('dialog [data-act="cancel"]').click()`);
  await sleep(1200);
  results.notion.stored = (await getGuide(guideId)).notion || null;

  // Next time: it opens at the last destination, and lists it under Recent.
  await openNotion();
  await waitFor(async () => (await selectedPath()).endsWith('some_topic_2'));
  results.notion.reopenPath = await selectedPath();
  results.notion.recents = await js(`[...document.querySelectorAll('dialog .recent-row')].map((r) => r.textContent)`);
  // Back to the top, then one click on the saved location.
  await js(`document.querySelector('dialog .crumbs .crumb').click()`);
  await waitRows(['Team wiki']);
  await js(`document.querySelector('dialog .chip-go').click()`);
  await waitFor(async () => (await selectedPath()).endsWith('some_topic_2'));
  results.notion.chipPath = await selectedPath();
  // Search across the workspace, then jump to the hit (path found via its parents).
  await js(`document.querySelector('dialog .crumbs .crumb').click()`);
  await waitRows(['Team wiki']);
  await js(`(() => { const q = document.querySelector('dialog [name="q"]'); q.value = 'some_topic_2'; q.dispatchEvent(new Event('input')); })()`);
  await waitRows(['some_topic_2']);
  await clickRow('some_topic_2');
  await waitFor(async () => (await selectedPath()).endsWith('some_topic_2'));
  results.notion.searchPath = await selectedPath();

  // Ten saved locations is the limit; an 11th needs one removed first.
  const fill = Array.from({ length: 9 }, (_, i) => ({ name: `Place ${i + 1}`, id: `p-dummy-${i}`, title: `Dummy ${i}`, path: `Dummy ${i}`, crumbs: [{ id: `p-dummy-${i}`, title: `Dummy ${i}` }] }));
  await js(`(async () => { const s = await window.flowdocDesktop.settings.get(); await window.flowdocDesktop.notion.setSaved([...s.notion.saved, ...${JSON.stringify(fill)}]); })()`);
  results.notion.eleventh = await js(`(async () => {
    const s = await window.flowdocDesktop.settings.get();
    try { await window.flowdocDesktop.notion.setSaved([...s.notion.saved, { name: 'Eleven', id: 'p-eleven', crumbs: [] }]); return 'accepted'; }
    catch (e) { return String(e.message); }
  })()`);
  await js(`document.querySelector('dialog [data-act="cancel"]').click()`);
  await sleep(300);
  await openNotion();
  await js(`document.querySelector('dialog .crumbs .crumb').click()`);
  await waitRows(['Team wiki']);
  await clickRow('Team wiki');
  await waitRows(['How-tos', 'Archive']);
  await clickRow('Archive');
  await waitFor(async () => (await selectedPath()).endsWith('Archive'));
  results.notion.whenFull = await js(`({
    count: document.querySelector('dialog .count').textContent,
    starDisabled: document.querySelector('dialog [data-act="star"]').disabled,
    message: document.querySelector('dialog .limit-msg').hidden ? '' : document.querySelector('dialog .limit-msg').textContent,
  })`);
  await shot(mainWin, 'desktop-notion-full.png');
  await js(`document.querySelectorAll('dialog .chip-x')[1].click()`);
  await waitFor(() => js(`document.querySelector('dialog .count').textContent === '9/10'`));
  results.notion.afterRemove = await js(`({ count: document.querySelector('dialog .count').textContent, starDisabled: document.querySelector('dialog [data-act="star"]').disabled })`);
  await js(`document.querySelector('dialog [data-act="cancel"]').click()`);
  await sleep(300);


  // ---------- data from StepCraft carried over ----------
  results.legacyGuide = (await getGuide('glegacy01'))?.title || null;

  // Settings upgrade: the retired default moves to the new one exactly once.
  {
    const file = join(out, 'migration-settings.json');
    writeFileSync(file, JSON.stringify({ settings: { ai: { provider: 'gemini', models: { gemini: 'gemini-3.8-flash' } } }, keys: {} }));
    const first = createSettings(file);
    const model = (await first.get()).ai.models.gemini;
    await first.update({ ai: { models: { gemini: 'gemini-3.8-flash' } } }); // user picks it again on purpose
    const keptChoice = (await createSettings(file).get()).ai.models.gemini;
    results.migration = { model, keptChoice };
  }

  // ---------- custom guides folder ----------
  progress('guides folder');
  {
    const st = {};
    const before = await js(`window.flowdocDesktop.storage.get()`);
    st.before = { isDefault: before.isDefault, guides: before.guides };
    const empty = mkdtempSync(join(tmpdir(), 'flowdoc-lib-'));
    const busy = mkdtempSync(join(tmpdir(), 'flowdoc-busy-'));
    writeFileSync(join(busy, 'my-notes.txt'), 'not a FlowDoc file');
    st.inspectEmpty = await js(`window.flowdocDesktop.storage.inspect(${JSON.stringify(empty)})`);
    st.inspectBusy = await js(`window.flowdocDesktop.storage.inspect(${JSON.stringify(busy)})`);
    // Switch to the empty folder, copying the guides across.
    const applied = await js(`window.flowdocDesktop.storage.apply({ target: ${JSON.stringify(empty)}, copy: true })`);
    st.applied = { dir: applied.dir, copied: applied.copied, guides: applied.guides, isDefault: applied.isDefault };
    st.filesInNew = existsSync(join(empty, `guide_${guideId}.json`)) && existsSync(join(empty, 'guides_index.json'));
    // The library now reads and writes in the new folder.
    const g = await getGuide(guideId);
    g.description = 'Edited while stored in a custom folder';
    await saveGuide(g);
    st.writesGoToNew = JSON.parse(readFileSync(join(empty, `guide_${guideId}.json`), 'utf8')).description === g.description;
    st.savedSetting = (await settings.get()).storage.libraryDir;
    // The Settings dialog shows it.
    await js(`location.hash = '#/'; window.flowdocApp.route()`);
    await sleep(500);
    await js(`document.querySelector('.settings-btn').click()`);
    await waitFor(() => js(`document.querySelector('dialog .folder-path')?.textContent || null`));
    st.ui = await js(`({ path: document.querySelector('dialog .folder-path').textContent, kind: document.querySelector('dialog .folder-kind').textContent, resetShown: !document.querySelector('dialog [data-act="resetFolder"]').hidden })`);
    await js(`document.querySelector('dialog [data-act="resetFolder"]').click()`);
    await sleep(400);
    st.ui.confirm = await js(`document.querySelector('dialog .confirm-text')?.textContent || ''`);
    await shot(mainWin, 'desktop-settings-folder.png');
    await js(`document.querySelector('dialog [data-act="cancelFolder"]').click(); document.querySelector('dialog [data-close]').click();`);
    await sleep(300);
    // Back to the default folder; the edit made in the custom folder comes along.
    const reset = await js(`window.flowdocDesktop.storage.reset({ copy: true })`);
    st.reset = { isDefault: reset.isDefault, savedSetting: (await settings.get()).storage.libraryDir };
    st.editCameBack = (await getGuide(guideId)).description === 'Edited while stored in a custom folder';
    st.missingDriveUsable = await folderUsable('Q:\\\\definitely\\\\not\\\\here');
    results.storage = st;
  }

  progress('exports');
  // ---------- exports inside the desktop workspace ----------
  results.exports = await mainWin.webContents.executeJavaScript(`(async () => {
    const g = await window.flowdocApp.getGuide(${JSON.stringify(guideId)});
    const out = {};
    for (const f of ['pdf', 'docx', 'html', 'markdown', 'json']) {
      try {
        const { blob, filename } = await window.flowdocApp.exportGuide(g, f, {});
        out[f] = { size: blob.size, filename };
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
      } catch (err) { out[f] = { error: String(err) }; }
    }
    return out;
  })()`);
  await sleep(2500);

  writeFileSync(join(out, 'results.json'), JSON.stringify(results, null, 2));
  app.exit(0);
}
