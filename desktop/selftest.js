// Desktop self-test (FLOWDOC_SELFTEST=1). Opens the demo site in a window,
// feeds the recorder synthetic hook events at real element positions (so
// screen capture and the accessibility inspector run for real, without moving
// the user's mouse), exercises AI enhancement against a mock server, runs the
// exporters inside the workspace, and writes results.json for the runner.
import { BrowserWindow, desktopCapturer, nativeImage, nativeTheme, screen } from 'electron';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import uiohookPkg from 'uiohook-napi';
import { deleteGuide, getGuide, saveGuide } from '../extension/shared/guides.js';
import { createInspector } from './inspector/index.js';
import { createSettings } from './settings.js';
import { folderUsable } from './store.js';

const { uIOhook, UiohookKey: K } = uiohookPkg;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const progress = (msg) => console.log(`[selftest] ${msg}`);
const within = (promise, ms) => Promise.race([promise, sleep(ms)]);

export async function runSelfTest({ app, mainWin, recorder, startRecording, settings, listApps, areaPicker, areaFrame, applyBarProtection, markCapturable, getWidget }) {
  const out = process.env.FLOWDOC_TEST_OUT;
  mkdirSync(out, { recursive: true });
  const results = { checks: {}, notes: [] };
  const shot = async (win, name) => writeFileSync(join(out, name), (await win.webContents.capturePage()).toPNG());
  // Screenshots are WebP, and saved ones are app:// files: nativeImage reads
  // neither, so the workspace window decodes them into a PNG first.
  const decodeShot = async (src) =>
    nativeImage.createFromDataURL(
      await mainWin.webContents.executeJavaScript(`(async (src) => {
        const b = await createImageBitmap(await (await fetch(src)).blob());
        const c = document.createElement('canvas');
        c.width = b.width;
        c.height = b.height;
        c.getContext('2d').drawImage(b, 0, 0);
        return c.toDataURL('image/png');
      })(${JSON.stringify(src)})`),
    );

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
  const openDemo = async (page) => {
    const w = new BrowserWindow({
      width: Math.min(1100, area.width - 40),
      height: Math.min(760, area.height - 40),
      x: area.x + 20,
      y: area.y + 20,
      title: 'Northwind Support (FlowDoc self-test)',
      autoHideMenuBar: true,
      alwaysOnTop: true,
    });
    markCapturable(w);
    await w.loadURL(`app://flowdoc/demo/${page}`);
    return w;
  };
  let demo = await openDemo('index.html');
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
  // Wait for the recorder to actually change state rather than a fixed delay:
  // the bar ignores a second press while the first is still being handled.
  const untilPaused = async (want) => {
    for (let i = 0; i < 30 && recorder.state.paused !== want; i++) await sleep(100);
    return recorder.state.paused === want;
  };
  await press(results.widget.toggle);
  results.widget.pausedAfterClick = await untilPaused(true);
  await sleep(200); // let the bar re-enable its button
  await press(results.widget.toggle);
  results.widget.resumedAfterClick = await untilPaused(false);
  if (recorder.state.paused) recorder.setPaused(false); // never record the rest of the test paused

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
  // A double-click is one step with one screenshot, the one taken at its first
  // press: the second press only relabels that step.
  const libraryDir = (await mainWin.webContents.executeJavaScript('window.flowdocDesktop.storage.get()')).dir;
  const shotState = async () => {
    const g = await getGuide(recorder.state.guideId);
    const last = g.steps.at(-1);
    return {
      steps: g.steps.length,
      shots: g.steps.filter((st) => st.screenshot).length,
      files: readdirSync(join(libraryDir, 'assets')).length,
      last: { action: last?.action, text: last?.text, screenshot: last?.screenshot || null },
    };
  };
  await recorder.drain();
  const dblBefore = await shotState();
  await click('h1', { clicks: 1 });
  await click('h1', { clicks: 2 });
  await recorder.drain();
  results.doubleClick = { before: dblBefore, after: await shotState() };
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

  // ---------- continue capturing ----------
  // The editor's "Continue capturing" adds new steps after the last one and
  // keeps the guide's title and steps; Discard removes only the new steps.
  progress('continue capturing');
  const mainJs = (code) => mainWin.webContents.executeJavaScript(code);
  const snapshot = (g) => g.steps.map((s) => `${s.id}|${s.text}`);
  await mainJs(`location.hash = '#/guide/${guideId}'; window.flowdocApp.route()`);
  await sleep(700);
  demo = await openDemo('ticket.html');
  demo.focus();
  await sleep(800);
  const before = await getGuide(guideId);
  results.continue = { button: await mainJs(`!!document.querySelector('[data-act="continue"]')`) };
  await mainJs(`document.querySelector('[data-act="continue"]').click()`);
  // It asks what to record first; the last capture recorded the whole screen.
  for (let i = 0; i < 30 && !(await mainJs(`!!document.querySelector('dialog [data-start]')`)); i++) await sleep(100);
  results.continue.scopeDialog = await mainJs(`(() => {
    const d = document.querySelector('dialog[open]');
    return d ? { modes: [...d.querySelectorAll('input[name="scope"]')].map((r) => r.value), checked: d.querySelector('input[name="scope"]:checked')?.value } : null;
  })()`);
  // A picture of the app list, then back to the whole screen.
  await mainJs(`(() => { const r = document.querySelector('dialog input[value="apps"]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
  for (let i = 0; i < 30 && (await mainJs(`!document.querySelector('dialog .scope-app')`)); i++) await sleep(100);
  await shot(mainWin, 'desktop-scope-dialog.png');
  await mainJs(`(() => { const r = document.querySelector('dialog input[value="screen"]'); r.checked = true; r.dispatchEvent(new Event('change')); })()`);
  await mainJs(`document.querySelector('dialog [data-start]').click()`);
  for (let i = 0; i < 50 && !recorder.state.active; i++) await sleep(100);
  await sleep(500);
  results.continue.started = { sameGuide: recorder.state.guideId === guideId, stepCount: recorder.state.stepCount, continuing: recorder.state.continuing };
  results.continue.locked = await mainJs(`!!document.querySelector('.recording-banner') && !document.querySelector('[data-act="continue"]')`);
  await click('#subject');
  await click('h1');
  await recorder.drain();
  const continued = new Promise((r) => recorder.events.once('finished', r));
  await recorder.stop();
  await continued;
  await sleep(800);
  const afterContinue = await getGuide(guideId);
  results.continue.after = {
    beforeActions: before.steps.filter((s) => s.kind === 'action').length,
    added: afterContinue.steps.length - before.steps.length,
    keptOld: JSON.stringify(snapshot(afterContinue).slice(0, before.steps.length)) === JSON.stringify(snapshot(before)),
    titleKept: afterContinue.title === before.title,
    notRecording: !afterContinue.recording,
    newTexts: afterContinue.steps.slice(before.steps.length).map((s) => s.text),
    newShots: afterContinue.steps.slice(before.steps.length).filter((s) => s.screenshot).length,
    editorUnlocked: await mainJs(`location.hash === '#/guide/${guideId}' && !document.querySelector('.recording-banner') && !!document.querySelector('[data-act="continue"]')`),
  };
  await shot(mainWin, 'desktop-continued.png');
  // Continue again, then throw the new steps away.
  await recorder.start({ guideId });
  await click('h1');
  await recorder.drain();
  await recorder.discard();
  const afterDiscard = await getGuide(guideId);
  results.continue.discard = {
    exists: !!afterDiscard,
    sameSteps: !!afterDiscard && JSON.stringify(snapshot(afterDiscard)) === JSON.stringify(snapshot(afterContinue)),
    notRecording: !!afterDiscard && !afterDiscard.recording,
  };

  // ---------- capture scope: specific apps, an area ----------
  // The demo window stands in for "another app": its key is FlowDoc's own
  // executable. "notepad-test" is a chosen app that isn't open.
  progress('scope: apps');
  const NOTEPAD = { key: 'notepad-test', name: 'Notepad' };
  const listed = await listApps([NOTEPAD]);
  results.scope = {
    list: {
      count: listed.length,
      shell: listed.filter((a) => a.shell).map((a) => a.name),
      keptClosed: listed.some((a) => a.key === NOTEPAD.key && a.closed),
      shellLast: !!listed.at(-1)?.shell,
    },
  };
  const strays = [];
  const onStray = (a) => strays.push(a);
  recorder.events.on('stray', onStray);
  const widgetJs = (code) => widget.webContents.executeJavaScript(code);
  const db = (w) => screen.getDisplayMatching(w.getBounds());
  const fraction = (r, d) => ({ x: (r.x - d.bounds.x) / d.bounds.width, y: (r.y - d.bounds.y) / d.bounds.height, w: r.width / d.bounds.width, h: r.height / d.bounds.height });
  await startRecording({ scope: { mode: 'apps', apps: [NOTEPAD] } });
  await sleep(400);
  const appsId = recorder.state.guideId;
  results.scope.apps = { bar: await widgetJs(`(() => { const b = document.getElementById('scope'); return { shown: !b.hidden, text: b.textContent.trim() }; })()`) };
  await click('h1');
  await recorder.drain();
  await sleep(200);
  results.scope.apps.ignored = recorder.state.stepCount;
  results.scope.apps.stray = strays.at(-1) || null;
  results.scope.apps.notice = await widgetJs(`(() => { const n = document.getElementById('notice'); return { shown: !n.hidden, text: document.getElementById('noticeText').textContent }; })()`);
  await widgetJs(`document.getElementById('scope').click()`);
  await sleep(1500);
  await shot(widget, 'desktop-bar-apps.png');
  results.scope.apps.panel = await widgetJs(`(() => ({ shown: !document.getElementById('panel').hidden, rows: document.querySelectorAll('#appList .app').length, icons: [...document.querySelectorAll('#appList img')].map((i) => i.naturalWidth > 0), fits: document.getElementById('wrap').getBoundingClientRect().height <= innerHeight + 1 }))()`);
  await widgetJs(`document.getElementById('panelClose').click()`);
  await sleep(300);
  // The bar's Add button: adds the app and keeps the click just made.
  const addAt = await widgetJs(`(() => { const b = document.getElementById('noticeAdd').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  await press(addAt);
  for (let i = 0; i < 30 && recorder.state.stepCount < 1; i++) await sleep(100);
  results.scope.apps.kept = recorder.state.stepCount;
  results.scope.apps.barAfter = await widgetJs(`document.getElementById('scope').textContent.trim()`);
  await click('#subject');
  await recorder.drain();
  await recorder.stop();
  await sleep(500);
  const appsGuide = await getGuide(appsId);
  results.scope.apps.steps = appsGuide.steps.map((s) => ({ text: s.text, crop: s.crop, app: s.app }));
  results.scope.apps.saved = appsGuide.captureScope;
  results.scope.apps.expectedCrop = fraction(demo.getBounds(), db(demo));
  recorder.events.off('stray', onStray);

  progress('scope: area');
  // The area picker, driven like a person: drag a rectangle around the
  // Subject field on the demo's display, then press Start.
  const rectOf = async (selector) => {
    const r = await demo.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
    const cb = demo.getContentBounds();
    return { x: cb.x + r.x, y: cb.y + r.y, width: r.width, height: r.height };
  };
  const subject = await rectOf('#subject');
  const display = db(demo);
  const want = { x: Math.round(subject.x - 20), y: Math.round(subject.y - 20), width: Math.round(subject.width + 40), height: Math.round(subject.height + 40) };
  const picking = startRecording({ scope: { mode: 'area' } });
  for (let i = 0; i < 50 && areaPicker.windows.length === 0; i++) await sleep(100);
  await sleep(1200);
  results.scope.area = { overlays: areaPicker.windows.length, displays: screen.getAllDisplays().length };
  const overlay = areaPicker.windows.find((w) => w.displayId === display.id);
  if (overlay) {
    const lx = want.x - display.bounds.x;
    const ly = want.y - display.bounds.y;
    const ow = overlay.webContents;
    ow.sendInputEvent({ type: 'mouseMove', x: lx, y: ly });
    ow.sendInputEvent({ type: 'mouseDown', x: lx, y: ly, button: 'left', clickCount: 1 });
    for (let t = 1; t <= 6; t++) {
      ow.sendInputEvent({ type: 'mouseMove', x: Math.round(lx + (want.width * t) / 6), y: Math.round(ly + (want.height * t) / 6), button: 'left', modifiers: ['leftButtonDown'] });
      await sleep(30);
    }
    ow.sendInputEvent({ type: 'mouseUp', x: lx + want.width, y: ly + want.height, button: 'left', clickCount: 1 });
    await sleep(300);
    results.scope.area.selected = await ow.executeJavaScript(`(() => { const s = document.getElementById('sel').getBoundingClientRect(); return { x: s.x, y: s.y, width: s.width, height: s.height, bar: getComputedStyle(document.getElementById('bar')).display }; })()`);
    await shot(overlay, 'desktop-area-picker.png');
    const startAt = await ow.executeJavaScript(`(() => { const b = document.getElementById('start').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
    ow.sendInputEvent({ type: 'mouseDown', x: Math.round(startAt.x), y: Math.round(startAt.y), button: 'left', clickCount: 1 });
    ow.sendInputEvent({ type: 'mouseUp', x: Math.round(startAt.x), y: Math.round(startAt.y), button: 'left', clickCount: 1 });
  }
  const areaState = await within(picking, 8000);
  results.scope.area.started = !!areaState?.active;
  results.scope.area.area = areaState?.scope?.area || null;
  results.scope.area.want = { ...want, displayId: display.id };
  results.scope.area.overlaysClosed = areaPicker.windows.length === 0 && !areaPicker.open;
  if (areaState?.active) {
    const areaId = areaState.guideId;
    await sleep(300);
    const a = areaState.scope.area;
    const strips = areaFrame.pieces();
    results.scope.area.frame = {
      count: strips.length,
      bounds: areaFrame.bounds,
      visible: areaFrame.visible,
      outside: strips.every((r) => r.x + r.width <= a.x || r.x >= a.x + a.width || r.y + r.height <= a.y || r.y >= a.y + a.height),
      hugs: strips.every((r) => r.x <= a.x + a.width + 4 && r.x + r.width >= a.x - 4 && r.y <= a.y + a.height + 4 && r.y + r.height >= a.y - 4),
    };
    // Real window bounds: nothing of FlowDoc's may sit over the area itself.
    const over = (r) => r.x < a.x + a.width && r.x + r.width > a.x && r.y < a.y + a.height && r.y + r.height > a.y;
    const bar = getWidget().getBounds();
    results.scope.area.clear = { strips: strips.every((r) => !over(r)), bar: getWidget().isVisible() && !over(bar), barBounds: bar };
    results.scope.area.bar = await widgetJs(`(() => { const b = document.getElementById('scope'); return { shown: !b.hidden, text: b.textContent.trim() }; })()`);
    await click('#submit'); // outside the area
    await click('#subject'); // inside
    await type('Hi');
    await sleep(2600);
    await recorder.drain();
    await recorder.stop();
    await sleep(300);
    results.scope.area.frameHiddenAfter = !areaFrame.visible;
    const areaGuide = await getGuide(areaId);
    results.scope.area.steps = areaGuide.steps.map((s) => ({ text: s.text, crop: s.crop }));
    results.scope.area.expectedCrop = fraction(want, display);
    results.scope.area.saved = areaGuide.captureScope;
  } else {
    for (const w of areaPicker.windows) w.webContents.send('area:clear');
  }

  // ---------- recorder bar visible to other apps (Settings > Capture) ----------
  // Unticking "Hide the recorder bar…" lets screen recorders and meetings see
  // the bar and the area border; FlowDoc still keeps the bar out of its own
  // shots (Linux blurs it), and clicks on it are still not steps.
  progress('recorder bar visibility');
  {
    const bar = getWidget();
    const prot = (w) => (typeof w.isContentProtected === 'function' ? w.isContentProtected() : null);
    const probe = { x: 200, y: 200, width: 300, height: 200 };
    const borderProtected = () => {
      areaFrame.show(probe);
      const all = areaFrame.windows().map(prot);
      areaFrame.hide();
      return all;
    };
    const bv = { setting: (await settings.get()).capture.hideBar, barProtected: prot(bar), borderProtected: borderProtected() };
    const toggle = async () => {
      await mainJs(`document.querySelector('.settings-btn').click()`);
      for (let i = 0; i < 30 && !(await mainJs(`!!document.querySelector('dialog [name="hideBar"]')`)); i++) await sleep(100);
      await mainJs(`document.querySelector('dialog [data-tab="capture"]').click(); document.querySelector('dialog [name="hideBar"]').scrollIntoView({ block: 'center' })`);
      if (!bv.pictured) {
        await sleep(300);
        await shot(mainWin, 'desktop-settings-capture.png');
        bv.pictured = true;
      }
      const box = await mainJs(`(() => { const c = document.querySelector('dialog [name="hideBar"]'); c.click(); return { was: !c.checked, disabled: c.disabled }; })()`);
      await sleep(500);
      await mainJs(`document.querySelector('dialog [data-close]').click()`);
      await sleep(200);
      return box;
    };
    bv.checkbox = await toggle();
    bv.off = { saved: (await settings.get()).capture.hideBar, barProtected: prot(bar), borderProtected: borderProtected() };
    demo.focus();
    await sleep(400);
    const started = await startRecording({ scope: { mode: 'screen' } });
    await sleep(600);
    const b = bar.getBounds();
    bv.barShown = bar.isVisible();
    const before = recorder.state.stepCount;
    // On a small screen the demo can sit under the bar, and the test marks the
    // demo as a window to record; hide it so the click is only on the bar.
    demo.hide();
    const phys = toPhysical({ x: Math.round(b.x + 12), y: Math.round(b.y + b.height / 2) });
    recorder.simulate.mousedown({ x: phys.x, y: phys.y, button: 1, clicks: 1 });
    await sleep(700);
    await recorder.drain();
    bv.barClickIgnored = recorder.state.stepCount === before;
    demo.showInactive();
    await sleep(300);
    await click('#subject');
    await recorder.drain();
    bv.barProtectedAfterShot = prot(bar);
    const g = await getGuide(started.guideId);
    const last = g.steps.filter((s) => s.kind === 'action').at(-1);
    const d = screen.getDisplayMatching(b).bounds;
    const want = { x: (b.x - d.x) / d.width, y: (b.y - d.y) / d.height, w: b.width / d.width, h: b.height / d.height };
    const r = last?.redactions?.[0];
    bv.blurred = { count: last?.redactions?.length || 0, matches: !!r && ['x', 'y', 'w', 'h'].every((k) => Math.abs(r[k] - want[k]) < 0.01) };
    // What a screen recorder or meeting app sees: grab the screen with the bar
    // visible to captures, then hidden, and compare the bar's spot. FlowDoc's
    // own shot of that spot should look like the hidden grab.
    // Each crop is also saved (bar-*.png) to look at when a check fails.
    const barSpot = (img, name) => {
      const k = img.getSize().width / d.width;
      const spot = img.crop({ x: Math.round((b.x - d.x) * k), y: Math.round((b.y - d.y) * k), width: Math.round(b.width * k), height: Math.round(b.height * k) }).resize({ width: b.width, height: b.height });
      writeFileSync(join(out, `bar-${name}.png`), spot.toPNG());
      return spot.toBitmap();
    };
    const barPixels = async (name) => {
      await sleep(400);
      const dd = screen.getDisplayMatching(b);
      const size = { width: Math.round(d.width * dd.scaleFactor), height: Math.round(d.height * dd.scaleFactor) };
      const src = (await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })).find((x) => x.display_id === String(dd.id)) || null;
      return src ? barSpot(src.thumbnail, name) : null;
    };
    const meanDiff = (a, c) => {
      if (!a || !c || a.length !== c.length) return null;
      let diff = 0;
      for (let i = 0; i < a.length; i += 4) diff += Math.abs(a[i] - c[i]) + Math.abs(a[i + 1] - c[i + 1]) + Math.abs(a[i + 2] - c[i + 2]);
      return Math.round(diff / (a.length / 4));
    };
    const seen = await barPixels('visible');
    applyBarProtection(true);
    const unseen = await barPixels('hidden');
    applyBarProtection(false);
    bv.screenGrab = seen && unseen ? { meanDiff: meanDiff(seen, unseen) } : { error: 'no screen source' };
    const ours = last?.screenshot ? barSpot(await decodeShot(last.screenshot), 'own-shot') : null;
    bv.ownShot = { barHidden: !!ours, toHidden: meanDiff(ours, unseen), toVisible: meanDiff(ours, seen) };
    // Shots that overlap (a click's shot while a held repeated click is being
    // judged): one shot showing the bar again must not let it into another.
    // Each shot marked as without the bar has to look like the hidden grab.
    // First let the screen stream catch up with the bar being visible again.
    await sleep(800);
    bv.overlapBefore = await recorder.simulate.shot({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).then((f) => f && { barHidden: !!f.barHidden });
    await sleep(800);
    const shots = await Promise.all(
      Array.from({ length: 10 }, (_, i) => sleep(i * 30).then(() => recorder.simulate.shot({ x: b.x + b.width / 2, y: b.y + b.height / 2 }))),
    );
    bv.overlap = await Promise.all(
      shots.map(async (f, i) => {
        if (!f?.dataUrl) return { i, error: 'no shot' };
        const spot = barSpot(await decodeShot(f.dataUrl), `overlap-${i}`);
        return { i, barHidden: !!f.barHidden, toHidden: meanDiff(spot, unseen), toVisible: meanDiff(spot, seen) };
      }),
    );
    await recorder.discard();
    bv.discarded = !(await getGuide(started.guideId));
    bv.restoreBox = await toggle();
    bv.on = { saved: (await settings.get()).capture.hideBar, barProtected: prot(bar), borderProtected: borderProtected() };
    results.barVisibility = bv;
  }

  // ---------- repeated clicks (Settings > Capture) ----------
  // Clicking the same thing again when nothing changed is not a new step;
  // clicks that change something are all kept; the setting turns it off.
  progress('repeated clicks');
  {
    const rc = { setting: (await settings.get()).capture.ignoreRepeats };
    // Plain buttons with no hover look, so only what a click does shows up on screen.
    await demo.webContents.executeJavaScript(`(() => {
      const add = (id, text, top, onclick) => {
        const b = document.createElement('button');
        b.id = id;
        b.textContent = text;
        b.style.cssText = 'position:fixed;left:24px;top:' + top + 'px;z-index:9;padding:8px 14px;background:#e2e8f0;color:#0f172a;border:1px solid #64748b;border-radius:6px;font:14px sans-serif;outline:none';
        if (onclick) b.onclick = onclick;
        document.body.append(b);
      };
      add('noop', 'Refresh', 16);
      // The button keeps its name; only a small total next to it changes.
      const total = document.createElement('span');
      total.style.cssText = 'position:fixed;left:140px;top:72px;z-index:9;font:14px sans-serif;color:#0f172a';
      total.textContent = 'Total: 0';
      document.body.append(total);
      let n = 0;
      add('count', 'Add one', 64, () => (total.textContent = 'Total: ' + ++n));
      // Like clicking away a text selection: only the first click changes anything.
      const mark = document.createElement('span');
      mark.style.cssText = 'position:fixed;left:140px;top:120px;z-index:9;font:14px sans-serif;color:#0f172a;background:#fde047;padding:2px 6px';
      mark.textContent = 'selected text';
      document.body.append(mark);
      add('clear', 'Clear', 112, () => (mark.style.background = 'transparent'));
      // A word in text: double-clicking selects it and, like Chrome's "Define",
      // shows a bubble under it that follows where exactly you clicked and
      // fades after a while. Picking the same word again changes nothing else.
      const para = document.createElement('p');
      para.style.cssText = 'position:fixed;left:24px;top:150px;z-index:9;margin:0;font:16px sans-serif;color:#0f172a;background:#fff';
      para.innerHTML = '<b id="word">Official</b> rules apply here.';
      document.body.append(para);
      const bubble = document.createElement('div');
      bubble.textContent = 'Define';
      bubble.style.cssText = 'position:fixed;display:none;z-index:10;padding:6px 12px;background:#334155;color:#fff;font:13px sans-serif;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.35)';
      document.body.append(bubble);
      let fade = 0;
      document.addEventListener('dblclick', (e) => {
        if (e.target.id !== 'word') return;
        bubble.style.left = e.clientX - 30 + 'px';
        bubble.style.top = e.clientY + 26 + 'px';
        bubble.style.display = 'block';
        clearTimeout(fade);
        fade = setTimeout(() => (bubble.style.display = 'none'), 2500);
      });
      // A button with a tooltip: pressing it hides the tooltip, which comes
      // back under the pointer a moment later. Clicking it changes nothing else.
      add('help', 'Help', 196);
      const tip = document.createElement('div');
      tip.textContent = 'Shows the help for this page';
      tip.style.cssText = 'position:fixed;display:none;z-index:10;padding:4px 8px;background:#fffbe6;color:#0f172a;border:1px solid #94a3b8;font:12px sans-serif';
      document.body.append(tip);
      const help = document.getElementById('help');
      help.addEventListener('mousedown', () => (tip.style.display = 'none'));
      help.addEventListener('mouseup', (e) => setTimeout(() => {
        tip.style.left = e.clientX + 'px';
        tip.style.top = e.clientY + 22 + 'px';
        tip.style.display = 'block';
      }, 300));
    })()`);
    demo.showInactive();
    await sleep(500);
    // Both presses of a double-click, the way the hook and the page see them.
    // `dx` moves the point a little, as a person never hits the same pixel twice.
    async function dblclick(selector, dx = 0) {
      const { css, dip } = await centerOf(selector);
      const phys = toPhysical({ x: Math.round(dip.x + dx), y: Math.round(dip.y) });
      const at = { x: Math.round(css.x + dx), y: Math.round(css.y), button: 'left' };
      for (const clickCount of [1, 2]) {
        recorder.simulate.mousedown({ x: phys.x, y: phys.y, button: 1, clicks: clickCount });
        await sleep(40);
        demo.webContents.sendInputEvent({ type: 'mouseDown', ...at, clickCount });
        demo.webContents.sendInputEvent({ type: 'mouseUp', ...at, clickCount });
        await sleep(120);
      }
      await sleep(700);
    }
    const texts = async (id) => (await getGuide(id)).steps.filter((s) => s.kind === 'action').map((s) => s.text);
    const started = await startRecording({ scope: { mode: 'screen' } });
    await sleep(600);
    for (let i = 0; i < 3; i++) await click('#noop');
    for (let i = 0; i < 3; i++) await click('#count');
    for (let i = 0; i < 3; i++) await click('#clear');
    for (let i = 0; i < 2; i++) await dblclick('#noop');
    for (let i = 0; i < 2; i++) await click('#noop', { button: 2 });
    await click('#noop');
    await dblclick('#noop'); // a different kind of click from the one before: kept
    // The same word double-clicked again and again, a few pixels apart: one step.
    for (const dx of [0, -6, 5, 0]) await dblclick('#word', dx);
    await sleep(2600); // the bubble fades before the next test
    // A button whose tooltip comes and goes: one step.
    for (let i = 0; i < 3; i++) await click('#help');
    await sleep(1800); // the last held click is decided
    await recorder.drain();
    rc.on = await texts(started.guideId);
    await recorder.discard();
    await settings.update({ capture: { ignoreRepeats: false } });
    const again = await startRecording({ scope: { mode: 'screen' } });
    await sleep(600);
    for (let i = 0; i < 2; i++) await click('#noop');
    await recorder.drain();
    rc.off = await texts(again.guideId);
    await recorder.discard();
    await settings.update({ capture: { ignoreRepeats: true } });
    results.repeatedClicks = rc;
  }
  demo.destroy();
  await shot(mainWin, 'desktop-editor.png');

  // ---------- browser tabs (Windows, with Edge installed) ----------
  // A click on another tab and Ctrl+Tab become "Navigate to <link>", read
  // from the browser's address bar; clicking the tab already shown again adds nothing.
  const EDGE = join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  if (win32 && existsSync(EDGE)) {
    progress('browser tabs');
    const bt = {};
    const pageA = pathToFileURL(join(process.cwd(), 'demo', 'index.html')).href;
    const pageB = pathToFileURL(join(process.cwd(), 'demo', 'ticket.html')).href;
    const profile = mkdtempSync(join(tmpdir(), 'flowdoc-edge-'));
    const edge = spawn(EDGE, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--window-position=40,40', '--window-size=1100,750', '--new-window', pageA, pageB], { stdio: 'ignore' });
    const probe = createInspector();
    try {
      await probe.warmUp();
      // Find the Edge window and a tab in its tab strip.
      let win = null;
      for (let i = 0; i < 40 && !win; i++) {
        await sleep(250);
        win = (await probe.windows()).find((w) => w.exe === 'msedge' && /Northwind/.test(w.title) && !w.minimized);
      }
      const tabAt = async (wantName) => {
        for (let y = win.rect.y + 12; y < win.rect.y + 70; y += 8) {
          for (let x = win.rect.x + 60; x < win.rect.x + 700; x += 30) {
            const el = await probe.elementAt(x, y);
            if (String(el?.type).toLowerCase() === 'tabitem' && wantName.test(el.name || '')) return { x, y };
          }
        }
        return null;
      };
      bt.window = !!win;
      const tabA = win && (await tabAt(/Sign in/));
      const tabB = win && (await tabAt(/ticket/i));
      bt.tabsFound = !!tabA && !!tabB;
      if (bt.tabsFound) {
        const started = await startRecording({ scope: { mode: 'screen' } });
        await sleep(600);
        const steps = async () => (await getGuide(started.guideId)).steps.filter((s) => s.kind === 'action');
        // The hook only reports the click; the tab on show stays as it is. A
        // click on a tab adds "Navigate to" the page on show once ...
        const clickTab = async (p) => {
          recorder.simulate.mousedown({ x: p.x, y: p.y, button: 1, clicks: 1 });
          await sleep(1500);
          await recorder.drain();
        };
        await clickTab(tabB);
        bt.first = (await steps()).map((s) => ({ action: s.action, text: s.text, href: s.href, shot: !!s.screenshot, target: !!s.target }));
        // ... and a second click with the same page on show changes nothing, so it adds nothing.
        await clickTab(tabB);
        bt.again = (await steps()).map((s) => s.action);
        // A real Ctrl+Tab switches Edge's tab (only when Edge is the window in
        // front), and the recorder is told about the key press.
        const front = await probe.browserUrl();
        bt.edgeInFront = front?.exe === 'msedge';
        if (bt.edgeInFront) {
          uIOhook.keyTap(K.Tab, [K.Ctrl]);
          recorder.simulate.keydown({ keycode: K.Tab, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
          await sleep(2000);
          await recorder.drain();
          bt.ctrlTab = (await steps()).at(-1);
          bt.ctrlTab = bt.ctrlTab && { action: bt.ctrlTab.action, text: bt.ctrlTab.text, href: bt.ctrlTab.href };
        }
        await recorder.discard();
      }
    } catch (err) {
      bt.error = String(err?.stack || err);
    } finally {
      probe.stop();
      spawn('taskkill', ['/PID', String(edge.pid), '/T', '/F'], { stdio: 'ignore' });
    }
    bt.pageA = pageA;
    bt.pageB = pageB;
    results.browserTabs = bt;
  }

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

  // ---------- translate ----------
  progress('translate');
  const tr = (results.translate = {});
  const buttonState = () => js(`(() => { const b = document.querySelector('[data-act="translate"]'); return b ? { needsAi: b.classList.contains('needs-ai'), aria: b.getAttribute('aria-disabled') } : null; })()`);
  // Without AI the button is greyed out, and clicking it says what's needed.
  await settings.update({ ai: { provider: 'off' } });
  await openGuide();
  tr.offButton = await buttonState();
  await js(`document.querySelector('[data-act="translate"]').click()`);
  await sleep(500);
  tr.needsAi = await js(`(() => { const d = document.querySelector('dialog .needs-ai'); return d ? { title: d.querySelector('h2').textContent, settingsButton: !!d.querySelector('[data-act="settings"]') } : null; })()`);
  await shot(mainWin, 'desktop-translate-needs-ai.png');
  await js(`document.querySelector('dialog .needs-ai [data-act="settings"]').click()`);
  await sleep(500);
  tr.settingsOpened = await js(`!!document.querySelector('dialog .settings #aiProvider')`);
  await js(`document.querySelector('dialog .settings [data-close]').click()`);
  await sleep(400);

  // With AI: translate into Tamil (the default), keeping on-screen names.
  await settings.update({ ai: { provider: 'gemini', models: { gemini: 'gemini-3.6-flash' } } });
  await settings.setKey('gemini', 'test-gemini-key');
  await openGuide();
  tr.onButton = await buttonState();
  const source = await getGuide(guideId);
  const sourceTexts = JSON.stringify(source.steps.map((s) => [s.text, s.note || '']));
  await js(`document.querySelector('[data-act="translate"]').click()`);
  await waitFor(() => js(`!!document.querySelector('dialog .translate')`), 5000);
  tr.dialog = await js(`(() => {
    const d = document.querySelector('dialog .translate');
    const sel = d.querySelector('[name="language"]');
    const label = (v) => [...sel.options].find((o) => o.value === v)?.textContent;
    return {
      groups: [...sel.querySelectorAll('optgroup')].map((g) => g.label),
      first: sel.options[0].textContent, selected: sel.value,
      tamil: label('ta'), hindi: label('hi'), english: label('en'), other: !!label('other'),
      parts: [...d.querySelectorAll('[name="part"]')].map((b) => b.checked),
      uiNames: d.querySelector('[name="uiNames"]:checked').value,
    };
  })()`);
  await shot(mainWin, 'desktop-translate-dialog.png');
  await js(`document.querySelector('dialog .translate .go').click()`);
  const copyId = await waitFor(async () => {
    const id = (await js('location.hash')).split('/').pop();
    return id && id !== guideId ? id : null;
  }, 5000);
  const copy = await waitFor(async () => {
    const g = copyId && (await getGuide(copyId));
    return g && g.title.startsWith('தமிழ்: ') && g;
  }, 30000);
  await sleep(800);
  if (copy) {
    const numbered = copy.steps.filter((s) => s.kind === 'action' || s.kind === 'manual');
    const typed = copy.steps.find((s) => String(s.text).includes('Printer offline'));
    tr.copy = {
      language: copy.language,
      from: copy.translatedFrom?.id === guideId,
      title: copy.title,
      sourceUnchanged: JSON.stringify((await getGuide(guideId)).steps.map((s) => [s.text, s.note || ''])) === sourceTexts,
      stepsTranslated: numbered.filter((s) => s.text.startsWith('தமிழ்: ')).length,
      steps: numbered.length,
      headings: copy.steps.filter((s) => s.kind === 'heading').map((s) => s.text),
      notesTranslated: copy.steps.filter((s) => s.note).every((s) => s.note.startsWith('தமிழ்: ')),
      typedValueKept: !!typed && !typed.text.startsWith('தமிழ்: ') && typed.text === source.steps.find((s) => s.text.includes('Printer offline'))?.text,
      boldKept: numbered.some((s) => /^தமிழ்: .*\*\*[A-Za-z][^*]*\*\*/.test(s.text)),
      editorLang: await js(`document.querySelector('.doc')?.getAttribute('lang')`),
      // The open editor shows the translation too (not an older copy).
      editorTitle: await js(`document.querySelector('.title-input')?.value || ''`),
      editorTamilBlocks: await js(`[...document.querySelectorAll('.b-text')].filter((e) => e.textContent.startsWith('தமிழ்: ')).length`),
    };
    await shot(mainWin, 'desktop-translated.png');
    // Exports: Helvetica can't draw Tamil, so the PDF draws that text itself.
    tr.exports = await js(`(async () => {
      const { exportGuide, getGuide } = window.flowdocApp;
      const pdf = async (id) => {
        const t = await (await exportGuide(await getGuide(id), 'pdf')).blob.text();
        return { images: (t.match(/\\/Subtype \\/Image/g) || []).length, questionMarks: (t.match(/\\?\\?\\?/g) || []).length };
      };
      const html = await (await exportGuide(await getGuide('${copyId}'), 'html')).blob.text();
      return { source: await pdf('${guideId}'), copy: await pdf('${copyId}'), htmlLang: html.includes('<html lang="ta"'), htmlTamil: html.includes('தமிழ்: ') };
    })()`);
    // Kept for a look at the pages.
    const tamilPdf = await js(`(async () => { const b = (await window.flowdocApp.exportGuide(await window.flowdocApp.getGuide('${copyId}'), 'pdf')).blob; const r = new FileReader(); return new Promise((ok) => { r.onload = () => ok(r.result.split(',')[1]); r.readAsDataURL(b); }); })()`);
    writeFileSync(join(out, 'desktop-translated-tamil.pdf'), Buffer.from(tamilPdf, 'base64'));
  }

  // Stop: the half-made copy is removed and the original opens again. (The
  // Groq mock is slow, so there's time to stop it.)
  await settings.update({ ai: { provider: 'groq', models: { groq: 'qwen/qwen3.8-27b' } } });
  await settings.setKey('groq', 'test-groq-key');
  await openGuide();
  await js(`document.querySelector('[data-act="translate"]').click()`);
  await waitFor(() => js(`!!document.querySelector('dialog .translate')`), 5000);
  await js(`document.querySelector('dialog .translate .go').click()`);
  const stopId = await waitFor(async () => {
    const id = (await js('location.hash')).split('/').pop();
    return id && id !== guideId && id !== copyId ? id : null;
  }, 5000);
  await waitFor(() => js(`!!document.querySelector('.ai-banner [data-act="stop"]')`), 5000);
  tr.stop = { banner: await js(`document.querySelector('.ai-banner b')?.textContent || ''`) };
  await js(`document.querySelector('.ai-banner [data-act="stop"]').click()`);
  await sleep(1500);
  tr.stop.copyRemoved = !!stopId && !(await getGuide(stopId));
  tr.stop.backToSource = (await js('location.hash')) === `#/guide/${guideId}`;
  await sleep(3500); // let the stopped request finish before the next part
  // Later checks count the guides in the library; take the copy out again.
  if (copyId) await deleteGuide(copyId);
  await settings.update({ ai: { provider: 'gemini', models: { gemini: 'gemini-3.6-flash' } } });

  // ---------- model picker ----------
  progress('settings: models + theme');
  await settings.update({ ai: { provider: 'gemini' } });
  await js(`document.querySelector('.settings-btn').click()`);
  await sleep(600);
  await js(`document.querySelector('dialog [data-tab="ai"]').click()`);
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

  // ---------- click highlight styles + "Highlights" toolbar toggle ----------
  progress('click highlights');
  await openGuide();
  results.highlight = await js(`(async () => {
    const { renderStepCanvas, setHighlightStyle } = await import('/app/render.js');
    const g = await window.flowdocApp.getGuide(${JSON.stringify(guideId)});
    const step = g.steps.find((s) => s.click && s.target && s.target.w > 40);
    const isRed = (p) => p[0] > 170 && p[1] < 120 && p[2] < 150;
    const sample = async (style, opts = {}, override = {}) => {
      if (style) setHighlightStyle(style);
      const c = await renderStepCanvas({ ...step, ...override }, { crop: false, ...opts });
      const scale = c.width / step.shot.viewportW;
      const ctx = c.getContext('2d');
      const px = (x, y) => ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
      const cx = step.click.x * scale, cy = step.click.y * scale;
      const ringHits = [0, 90, 180, 270].filter((deg) => {
        const a = (deg * Math.PI) / 180;
        return isRed(px(cx + Math.cos(a) * 15 * scale, cy + Math.sin(a) * 15 * scale));
      }).length;
      const t = step.target;
      const boxHit = isRed(px(t.x * scale - 4 * scale, (t.y + t.h / 2) * scale));
      return { ring: ringHits >= 3, centreClear: !isRed(px(cx, cy)), box: boxHit };
    };
    const out = {
      normal: await sample('normal'),
      box: await sample('box'),
      none: await sample('none'),
      // The AI always gets full marks, even with "None" and a hidden step.
      aiCrop: await sample('none', { highlightStyle: 'normal', forceHighlight: true }, { highlight: false }),
    };
    setHighlightStyle('normal');
    return out;
  })()`);

  // Toolbar toggle: hide on every step, then show again.
  const marked = async () => (await getGuide(guideId)).steps.filter((s) => s.kind === 'action' && s.screenshot && (s.target || s.click));
  const btnState = () => js(`(() => { const b = document.querySelector('[data-act="highlights"]'); return b ? { pressed: b.getAttribute('aria-pressed'), label: b.querySelector('.label').textContent, disabled: b.disabled } : null; })()`);
  results.highlight.toggle = { before: await btnState() };
  await js(`document.querySelector('[data-act="highlights"]').click()`);
  await sleep(900);
  results.highlight.toggle.afterHide = { button: await btnState(), allHidden: (await marked()).every((s) => s.highlight === false) };
  await shot(mainWin, 'desktop-highlights-off.png');
  await js(`document.querySelector('[data-act="highlights"]').click()`);
  await sleep(900);
  results.highlight.toggle.afterShow = { button: await btnState(), allShown: (await marked()).every((s) => s.highlight !== false) };

  // Settings: the three cards, and "None" disables the toolbar toggle.
  await js(`document.querySelector('.settings-btn').click()`);
  await waitFor(() => js(`!!document.querySelector('dialog [name="hlStyle"]')`));
  await js(`document.querySelector('dialog [data-tab="general"]').click()`);
  results.highlight.settings = await js(`({ options: [...document.querySelectorAll('dialog [name="hlStyle"]')].map((r) => r.value), checked: document.querySelector('dialog [name="hlStyle"]:checked')?.value })`);
  await js(`document.querySelector('dialog [name="hlStyle"][value="none"]').click()`);
  await sleep(500);
  await shot(mainWin, 'desktop-settings-highlight.png');
  results.highlight.settings.saved = await js(`localStorage.getItem('flowdoc.highlightStyle')`);
  results.highlight.settings.toolbarWhenNone = await btnState();
  await js(`document.querySelector('dialog [name="hlStyle"][value="normal"]').click(); document.querySelector('dialog [data-close]').click();`);
  await sleep(400);

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
    await js(`document.querySelector('dialog [data-tab="storage"]').click()`);
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

  progress('settings sidebar');
  // ---------- Settings: sections in a sidebar ----------
  {
    const sb = {};
    await js(`location.hash = '#/'; window.flowdocApp.route()`);
    await sleep(400);
    await js(`document.querySelector('.settings-btn').click()`);
    await waitFor(() => js(`!!document.querySelector('dialog [data-tab="storage"]')`));
    sb.tabs = await js(`[...document.querySelectorAll('dialog [role="tab"]')].map((b) => b.dataset.tab)`);
    // Sections sit in a sidebar left of the panel, stacked top to bottom, and
    // the dialog keeps one size whichever section is shown.
    sb.sidebar = await js(`(async () => {
      const d = document.querySelector('dialog');
      const nav = d.querySelector('.settings-tabs');
      const body = d.querySelector('.settings-body').getBoundingClientRect();
      const n = nav.getBoundingClientRect();
      const bs = [...d.querySelectorAll('[role="tab"]')];
      const rs = bs.map((b) => b.getBoundingClientRect());
      const sizes = [];
      const headings = {};
      for (const b of bs) {
        b.click();
        await new Promise((r) => setTimeout(r, 60));
        const r = d.querySelector('form').getBoundingClientRect();
        sizes.push(Math.round(r.width) + 'x' + Math.round(r.height));
        const shown = [...d.querySelectorAll('.settings-panel')].filter((p) => !p.hidden);
        headings[b.dataset.tab] = shown.length === 1 ? [...shown[0].querySelectorAll('h3')].map((h) => h.firstChild.textContent.trim()) : 'panels: ' + shown.length;
      }
      // Keyboard: Down/Up move through the sections (and wrap), Home/End jump.
      const keys = [];
      d.querySelector('[data-tab="general"]').click();
      d.querySelector('[data-tab="general"]').focus();
      for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'End', 'ArrowDown', 'ArrowUp', 'Home']) {
        document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
        const on = d.querySelector('[role="tab"][aria-selected="true"]');
        keys.push(on.dataset.tab + (document.activeElement === on ? '' : '!focus'));
      }
      return {
        orientation: nav.getAttribute('aria-orientation'),
        navLeft: n.right <= body.left + 1 && n.top <= body.top + 1 && n.bottom >= body.bottom - 1,
        stacked: rs.every((r, i) => !i || (r.top >= rs[i - 1].bottom - 1 && Math.abs(r.left - rs[0].left) < 1)),
        sizes: [...new Set(sizes)],
        headings,
        keys,
      };
    })()`);
    await js(`document.querySelector('dialog [data-tab="capture"]').click()`);
    await sleep(200);
    await shot(mainWin, 'desktop-settings-sidebar.png');
    await js(`document.querySelector('dialog [data-tab="storage"]').click()`);
    await sleep(100);
    sb.storage = await js(`[...document.querySelectorAll('dialog .settings-panel')].filter((p) => !p.hidden).map((p) => p.dataset.panel)`);
    await js(`document.querySelector('dialog [data-close]').click()`);
    await sleep(300);
    // Opening Settings again comes back to the section used last.
    await js(`document.querySelector('.settings-btn').click()`);
    sb.reopened = await waitFor(() => js(`document.querySelector('dialog [role="tab"][aria-selected="true"]')?.dataset.tab || null`), 5000).catch(() => null);
    sb.reopenedVisible = await js(`[...document.querySelectorAll('dialog .settings-panel')].filter((p) => !p.hidden).map((p) => p.dataset.panel)`);
    sb.focused = await js(`document.activeElement?.dataset?.tab || ''`);
    await js(`document.querySelector('dialog [data-close]').click()`);
    await sleep(300);
    results.settingsSidebar = sb;
  }

  progress('security and storage');
  // ---------- screenshots stored as files; the workspace locked down ----------
  {
    const sec = {};
    await sleep(600); // the guide list is written shortly after it changes
    const { dir } = await js(`window.flowdocDesktop.storage.get()`);
    const text = readFileSync(join(dir, `guide_${guideId}.json`), 'utf8');
    const refs = [...text.matchAll(/assets\/([0-9a-f]{40}\.(?:webp|jpg|png))/g)].map((m) => m[1]);
    sec.storage = {
      inlineImages: text.includes('data:image/'),
      refs: refs.length,
      filesExist: refs.length > 0 && refs.every((n) => existsSync(join(dir, 'assets', n))),
      webp: refs.filter((n) => n.endsWith('.webp')).length,
      guideKB: Math.round(text.length / 1024),
      indexInlineImages: readFileSync(join(dir, 'guides_index.json'), 'utf8').includes('data:image/'),
    };
    // Markup that sneaks into the page can't run script.
    sec.inlineScriptBlocked = await js(`new Promise((r) => {
      window.__flowdocInjected = 0;
      const d = document.createElement('div');
      d.innerHTML = '<img src="data:," onerror="window.__flowdocInjected = 1">';
      document.body.append(d);
      setTimeout(() => { d.remove(); r(window.__flowdocInjected === 0); }, 600);
    })`);
    // An imported file can't put markup or scripts into the page.
    sec.import = await js(`import('/app/exporters/index.js').then((m) => {
      const g = m.parseImport(JSON.stringify({ steps: [{ id: 'x"><img src=x onerror=alert(1)>', kind: '"><b>', text: 'hi', href: 'javascript:alert(1)', screenshot: 'https://example.invalid/x.png' }] }));
      const s = g.steps[0];
      return { id: s.id ?? null, kind: s.kind, href: s.href ?? null, screenshot: s.screenshot ?? null };
    })`);
    // The workspace window can't be navigated away from FlowDoc.
    const home = mainWin.webContents.getURL();
    await js(`location.href = 'file:///'; true`).catch(() => {});
    await sleep(700);
    sec.navigationBlocked = mainWin.webContents.getURL() === home;
    // Permissions FlowDoc doesn't use are refused.
    sec.geolocation = await js(`navigator.permissions.query({ name: 'geolocation' }).then((p) => p.state)`).catch((err) => String(err));
    sec.notifications = await js(`Notification.permission`).catch((err) => String(err));
    // The editor shows screenshots from the stored files.
    await js(`location.hash = '#/guide/${guideId}'; window.flowdocApp.route()`);
    await waitFor(() => js(`document.querySelector('.block .shot img')?.complete && document.querySelector('.block .shot img').naturalWidth > 0 || null`));
    sec.editorImage = await js(`(() => { const i = document.querySelector('.block .shot img'); return { blob: i.src.startsWith('blob:'), width: i.naturalWidth }; })()`);
    results.security = sec;
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
