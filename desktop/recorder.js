// System-wide recorder. A global mouse/keyboard hook (uiohook) sees every
// click and key press in any application; each one is turned into a guide
// step with a screenshot (capture.js) and a description of the element that
// was acted on (inspector/). Steps are written to the same guide format the
// workspace and exporters already use. A capture can be limited to one area
// of the screen or to some apps (scope.js); anything outside is not a step.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { nativeImage, screen } from 'electron';
import uiohookPkg from 'uiohook-napi';
import { createGuide, deleteGuide, getGuide, saveGuide } from '../extension/shared/guides.js';
import { appAllowed, appKey, appName, cleanScope, cropOf, pointInArea, SHELL } from './scope.js';

const { uIOhook, UiohookKey } = uiohookPkg;
const K = UiohookKey;

// ---------- keyboard: keycode -> character (US layout approximation) ----------

const CHAR = new Map();
const SHIFT_CHAR = new Map();
for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
  CHAR.set(K[c], c.toLowerCase());
  SHIFT_CHAR.set(K[c], c);
}
')!@#$%^&*('.split('').forEach((s, d) => {
  CHAR.set(K[String(d)], String(d));
  SHIFT_CHAR.set(K[String(d)], s);
});
for (const [name, plain, shifted] of [
  ['Space', ' ', ' '], ['Minus', '-', '_'], ['Equal', '=', '+'], ['BracketLeft', '[', '{'], ['BracketRight', ']', '}'],
  ['Backslash', '\\', '|'], ['Semicolon', ';', ':'], ['Quote', "'", '"'], ['Backquote', '`', '~'], ['Comma', ',', '<'],
  ['Period', '.', '>'], ['Slash', '/', '?'], ['NumpadMultiply', '*', '*'], ['NumpadAdd', '+', '+'],
  ['NumpadSubtract', '-', '-'], ['NumpadDecimal', '.', '.'], ['NumpadDivide', '/', '/'],
]) {
  if (K[name] === undefined) continue;
  CHAR.set(K[name], plain);
  SHIFT_CHAR.set(K[name], shifted);
}
for (let d = 0; d <= 9; d++) {
  if (K[`Numpad${d}`] !== undefined) {
    CHAR.set(K[`Numpad${d}`], String(d));
    SHIFT_CHAR.set(K[`Numpad${d}`], String(d));
  }
}
const MODIFIERS = new Set([K.Ctrl, K.CtrlRight, K.Alt, K.AltRight, K.Shift, K.ShiftRight, K.Meta, K.MetaRight, K.CapsLock].filter((k) => k !== undefined));
const META = new Set([K.Meta, K.MetaRight].filter((k) => k !== undefined));
const KEY_NAMES = new Map(
  Object.entries(K)
    .filter(([, code]) => typeof code === 'number')
    .map(([name, code]) => [code, name.replace(/^Arrow/, '').replace(/^Numpad/, 'Num ')]),
);
const PRESS_KEYS = new Set(['Delete', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Insert', 'PrintScreen'].map((n) => K[n]).filter((k) => k !== undefined));

// Browsers whose address bar the Windows inspector can read, and the keys
// that switch tabs in them.
const BROWSERS = new Set(['chrome', 'msedge', 'brave', 'vivaldi', 'opera', 'firefox', 'chromium']);
const TAB_KEYS = /^Ctrl\+(Shift\+)?(Tab|PageUp|PageDown|[1-9])$/;
const isAddressBar = (el) => el?.className === 'OmniboxViewViews' || el?.automationId === 'urlbar-input';

// Browsers leave the scheme out of the address bar ("github.com/avin045").
export function webUrl(text) {
  const t = String(text || '').trim();
  if (!t || /\s/.test(t)) return '';
  if (/^(https?|file):/i.test(t)) return t;
  if (/^[a-z]:[\\/]/i.test(t)) return `file:///${t.replace(/\\/g, '/')}`; // a local file
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?([/?#]|$)/i.test(t)) return `http://${t}`;
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(t)) return `https://${t}`;
  return ''; // chrome://, edge://, about: pages, or text being typed
}

// ---------- repeated clicks ----------

// Whether a screen changed between two shots of the same display, looking only
// inside `region` and outside `masks` (fractions of the display; null region =
// all of it). Strict on purpose: a few dozen changed pixels (a counter going
// from 1 to 2) count as a change, so only truly identical screens match.
export function shotsDiffer(a, b, region = null, masks = []) {
  const ia = nativeImage.createFromDataURL(a);
  const ib = nativeImage.createFromDataURL(b);
  const { width: W, height: H } = ia.getSize();
  const sb = ib.getSize();
  if (!W || !H || W !== sb.width || H !== sb.height) return true;
  const r = region || { x: 0, y: 0, w: 1, h: 1 };
  const box = { x: Math.round(r.x * W), y: Math.round(r.y * H), width: Math.max(1, Math.round(r.w * W)), height: Math.max(1, Math.round(r.h * H)) };
  box.width = Math.min(box.width, W - box.x);
  box.height = Math.min(box.height, H - box.y);
  const pa = ia.crop(box).toBitmap();
  const pb = ib.crop(box).toBitmap();
  const skip = masks.map((m) => ({ x1: m.x * W - box.x, y1: m.y * H - box.y, x2: (m.x + m.w) * W - box.x, y2: (m.y + m.h) * H - box.y }));
  let changed = 0;
  for (let y = 0; y < box.height; y++) {
    for (let x = 0; x < box.width; x++) {
      const i = (y * box.width + x) * 4;
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) <= 48) continue;
      if (skip.some((m) => x >= m.x1 && x < m.x2 && y >= m.y1 && y < m.y2)) continue;
      if (++changed > 40) return true;
    }
  }
  return false;
}

// ---------- text helpers ----------

const clean = (text, max = 60) => {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  // Windows taskbar buttons: "File Explorer - 2 running windows"
  t = t.replace(/\s+-\s+\d+ running windows?$/i, '').replace(/\s+-\s+pinned$/i, '');
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};
const b = (t) => `**${t}**`;
const CONTAINERS = new Set(['document', 'pane', 'window', 'titlebar', 'group', 'custom', 'client', 'frame', 'scrollviewer', 'unknown', '']);

export function describeClick(el, { button = 1, clicks = 1 } = {}) {
  const ownName = clean(el?.name);
  const name = ownName || clean(el?.parentName);
  const type = String((ownName ? el?.type : el?.parentType || el?.type) || '').toLowerCase();
  const context = clean(el?.window || el?.app);
  const verb = button === 2 ? 'Right-click' : clicks >= 2 ? 'Double-click' : 'Click';
  if (!name || (CONTAINERS.has(type) && !ownName)) return context ? `${verb} in ${b(context)}` : `${verb} here`;
  if (button === 2) return `Right-click ${b(name)}`;
  if (clicks >= 2) return `Double-click ${b(name)}`;
  switch (type) {
    case 'edit':
      return `Click the ${b(name)} field`;
    case 'combobox':
      return `Click the ${b(name)} dropdown`;
    case 'tabitem':
      return `Open the ${b(name)} tab`;
    case 'checkbox':
      return `${el?.toggle === 'On' ? 'Uncheck' : 'Check'} ${b(name)}`;
    case 'radiobutton':
      return `Select ${b(name)}`;
    case 'hyperlink':
      return `Click the ${b(name)} link`;
    default:
      return CONTAINERS.has(type) ? `Click in ${b(name)}` : `Click ${b(name)}`;
  }
}

export function describeTyping(field, value) {
  const label = clean(field?.name) || clean(field?.parentName);
  const where = label ? `the ${b(label)} field` : field?.window ? b(clean(field.window)) : 'the field';
  if (field?.isPassword) return `Type your password in ${where}`;
  if (value && value.length <= 120) return `Type "${clean(value, 120)}" in ${where}`;
  return `Type your text in ${where}`;
}

// ---------- recorder ----------

export function createRecorder({ capture, inspector, settings, isOwnWindow, isOwnElement = () => false, widgetBounds, barCover, log = () => {} }) {
  const events = new EventEmitter();
  let state = { active: false, paused: false, guideId: null, stepCount: 0, startedAt: 0 };
  let pipeline = Promise.resolve();
  let draft = null;
  let metaAlone = false;
  let lastClick = null; // { stepId, at, x, y }
  // The last step, when it was a click: what it hit and the screen just before
  // it. A click on the same thing with the screen unchanged since is a repeat.
  let lastClickStep = null; // { button, app, window, name, type, x, y, displayId, frame, region }
  let hookRunning = false;
  let captureSettings = {};
  // "Continue capturing": the ids of the steps the guide already had. They are
  // never rewritten, and Discard removes only the steps added after them.
  let keepIds = null;
  let scope = { mode: 'screen' };
  let lastInArea = false; // where the last click landed, for keys with no field rectangle
  // Apps mode: the last click in an app that isn't chosen. If the user adds
  // that app straight away, the click becomes a step after all.
  let stray = null; // { key, name, step, at }
  const muted = new Set(); // apps the user said not to ask about again
  const appRects = new Map(); // app key -> its main window (DIP), to crop popups in context

  const win = process.platform === 'win32';
  const toDip = (p) => (win ? screen.screenToDipPoint(p) : p);
  const rectToDip = (r) => (win ? screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h }) : { x: r.x, y: r.y, width: r.w, height: r.h });

  const emitState = () => events.emit('state', { ...state });
  const recording = () => state.active && !state.paused;

  function enqueue(fn) {
    const run = pipeline.then(fn);
    pipeline = run.catch((err) => log(`recorder: ${err.stack || err}`));
    return run;
  }

  // ---------- scope ----------

  function areaDisplay() {
    const a = scope.area;
    return screen.getAllDisplays().find((d) => d.id === a.displayId) || displayAt({ x: a.x + a.width / 2, y: a.y + a.height / 2 });
  }
  // The display a screenshot is taken of: the area's, or the one at `point`.
  const shotDisplay = (point) => (scope.mode === 'area' ? areaDisplay() : displayAt(point));

  // Whether a field or focused element (typing, key presses) is in scope.
  function inScope(el) {
    if (scope.mode === 'apps') return appAllowed(scope, el);
    if (scope.mode !== 'area') return true;
    const r = el?.rect && rectToDip(el.rect);
    if (!r || !(r.width > 0)) return lastInArea;
    const a = scope.area;
    return r.x < a.x + a.width && r.x + r.width > a.x && r.y < a.y + a.height && r.y + r.height > a.y;
  }

  // Area mode crops every shot to the area. Apps mode crops to the app's
  // window; a menu or dialog smaller than the app's last window is shown
  // together with that window, so it keeps its context.
  function cropFor(display, el) {
    if (scope.mode === 'area') return cropOf(scope.area, display);
    if (scope.mode !== 'apps' || !(el?.topRect?.w > 0)) return null;
    const r = rectToDip(el.topRect);
    const key = appKey(el);
    const main = appRects.get(key);
    if (main && r.width * r.height < main.width * main.height * 0.5) {
      const x = Math.min(r.x, main.x);
      const y = Math.min(r.y, main.y);
      return cropOf({ x, y, width: Math.max(r.x + r.width, main.x + main.width) - x, height: Math.max(r.y + r.height, main.y + main.height) - y }, display);
    }
    appRects.set(key, r);
    return cropOf(r, display);
  }

  function noteStray(el, step) {
    const key = appKey(el);
    if (!key || key === SHELL || muted.has(key)) return;
    stray = { key, name: appName(el) || key, step, at: Date.now() };
    events.emit('stray', { key, name: stray.name });
  }

  function saveScope() {
    const id = state.guideId;
    state.scope = cleanScope(scope);
    emitState();
    return enqueue(async () => {
      const guide = await getGuide(id);
      if (!guide) return;
      guide.captureScope = cleanScope(scope);
      await saveGuide(guide);
    });
  }

  const overlaps = (a, d) => a.x < d.x + d.width && a.x + a.width > d.x && a.y < d.y + d.height && a.y + a.height > d.y;
  const fractionOf = (a, d) => ({ x: (a.x - d.x) / d.width, y: (a.y - d.y) / d.height, w: a.width / d.width, h: a.height / d.height });

  // When other apps may see the recorder bar, it is kept out of our own shot
  // by hiding it from captures for a moment (capture.grab's `cover`). Where
  // that isn't possible (Linux), buildStep blurs it instead.
  function grab(display) {
    const wb = barCover && widgetBounds?.();
    if (!wb || !overlaps(wb, display.bounds)) return capture.grab(display);
    return capture.grab(display, { cover: { ...barCover, rect: fractionOf(wb, display.bounds) } });
  }

  // Builds a step relative to the display it happened on.
  function buildStep({ frame, display, point, el, rect, action, text, extra = {} }) {
    const db = display.bounds;
    const step = {
      id: randomUUID(),
      kind: 'action',
      action,
      text,
      highlight: true,
      redactions: [],
      crop: cropFor(display, el),
      createdAt: Date.now(),
      app: clean(el?.app, 80),
      window: clean(el?.window, 120),
      url: '',
      screenshot: frame?.dataUrl || null,
      shot: frame ? { width: frame.width, height: frame.height, viewportW: db.width, viewportH: db.height } : null,
      ...extra,
    };
    if (point) step.click = { x: point.x - db.x, y: point.y - db.y };
    const r = rect || el?.rect || (el?.parentRect && !el?.name ? el.parentRect : null);
    if (r && r.w > 0 && r.h > 0) {
      const d = rectToDip(r);
      const big = d.width * d.height > db.width * db.height * 0.4;
      if (!big) step.target = { x: d.x - db.x, y: d.y - db.y, w: d.width, h: d.height };
    }
    // A recorder bar that is still in the shot (Linux, or hiding it failed) is blurred.
    const wb = widgetBounds?.();
    if (wb && frame && !frame.barHidden && overlaps(wb, db)) step.redactions.push(fractionOf(wb, db));
    return step;
  }

  async function appendSteps(steps, { replaceId } = {}) {
    lastClickStep = null; // any new step ends a run of repeated clicks
    const guide = await getGuide(state.guideId);
    if (!guide) return;
    for (const step of steps) {
      const at = replaceId ? guide.steps.findIndex((s) => s.id === replaceId) : -1;
      if (at >= 0) guide.steps[at] = { ...guide.steps[at], ...step, id: replaceId };
      else guide.steps.push(step);
    }
    await saveGuide(guide);
    state.stepCount = guide.steps.filter((s) => s.kind === 'action').length;
    emitState();
  }

  // A step that happened a moment ago, placed among this session's steps by time.
  async function insertStep(step) {
    const guide = await getGuide(state.guideId);
    if (!guide) return;
    let at = guide.steps.length;
    while (at > 0 && guide.steps[at - 1].createdAt > step.createdAt && !keepIds?.has(guide.steps[at - 1].id)) at--;
    guide.steps.splice(at, 0, step);
    await saveGuide(guide);
    state.stepCount = guide.steps.filter((s) => s.kind === 'action').length;
    emitState();
  }

  async function patchStep(id, patch) {
    const guide = await getGuide(state.guideId);
    const step = guide?.steps.find((s) => s.id === id);
    if (!step) return;
    Object.assign(step, patch);
    await saveGuide(guide);
  }

  function displayAt(point) {
    return screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) });
  }

  // ---------- browser tabs ----------

  // Switching browser tabs (a click on a tab, Ctrl+Tab and friends) or
  // pressing Enter in the address bar becomes "Navigate to <link>", with a
  // shot of the page it opened. Nothing when the guide is already on that page.
  async function browserNavigation(el, display, wait = 600) {
    if (!inspector.browserUrl || !BROWSERS.has(String(el?.topExe || el?.exe || '').toLowerCase())) return null;
    await new Promise((r) => setTimeout(r, wait));
    const info = await inspector.browserUrl(el.hwnd);
    const url = webUrl(info?.url);
    if (!url) return null;
    const guide = await getGuide(state.guideId);
    if (guide?.steps.findLast((s) => s.url)?.url === url) return null;
    const frame = await grab(display);
    // No highlight: the tab or field acted on isn't what the new page shows.
    const page = { ...el, rect: null, parentRect: null };
    return buildStep({ frame, display, el: page, action: 'navigate', text: `Navigate to ${b(url)}`, extra: { href: url, url, pageTitle: clean(info.title, 120) } });
  }

  // A click that changes nothing, on the same thing as the click before it
  // (someone clicking again while an app is slow, or unsure it worked), is not
  // a new step. Such a click is held for a moment (`pendingClick`) and judged
  // by the screen: it is dropped when nothing changed between the two clicks
  // (the first one didn't respond yet), or when this click itself changed
  // nothing (compared with the screen at the next action, or 1.5 s later).
  // Clicks, double-clicks and right-clicks are each compared with their own
  // kind. Settings > Capture > "Ignore repeated clicks that change nothing".
  let pendingClick = null; // { step, record, prev, display, timer }
  const SETTLE_MS = 1500;

  function clickRecord(el, point, button, display, frame, stepId) {
    // The app's window, a little inside its edges: the frame Windows reports
    // can take in a few pixels of whatever is behind the window.
    const w = el?.topRect?.w > 0 ? rectToDip(el.topRect) : null;
    const r = w && w.width > 24 && w.height > 24 ? cropOf({ x: w.x + 8, y: w.y + 8, width: w.width - 16, height: w.height - 16 }, display) : null;
    return {
      stepId,
      kind: button === 2 ? 'rightclick' : 'click', // becomes 'dblclick' on a second press
      button,
      app: appKey(el),
      window: clean(el?.window, 120),
      name: clean(el?.name || el?.parentName),
      type: String(el?.type || ''),
      x: point.x,
      y: point.y,
      displayId: display.id,
      frame,
      region: scope.mode === 'area' ? cropOf(scope.area, display) : r,
    };
  }

  // Whether `cur` is a click on the same thing as `prev`, right after it.
  function sameTarget(prev, cur) {
    if (captureSettings.ignoreRepeats === false || !prev || !prev.frame?.dataUrl || !cur.frame?.dataUrl) return false;
    if (prev.button !== cur.button || prev.displayId !== cur.displayId || prev.app !== cur.app || prev.window !== cur.window) return false;
    const near = Math.hypot(prev.x - cur.x, prev.y - cur.y);
    return prev.name && cur.name ? prev.name === cur.name && prev.type === cur.type && near < 60 : near < 15;
  }

  // Whether the screen looks the same in two shots of `rec`'s window, leaving
  // out the mouse pointer at `points` and the recorder bar.
  function unchanged(a, b, rec, display, points) {
    if (!a?.dataUrl || !b?.dataUrl) return false;
    const db = display.bounds;
    const pointer = (p) => ({ x: (p.x - 6 - db.x) / db.width, y: (p.y - 6 - db.y) / db.height, w: 48 / db.width, h: 56 / db.height });
    const masks = points.filter(Boolean).map(pointer);
    const wb = widgetBounds?.();
    if (wb && overlaps(wb, db)) masks.push(fractionOf(wb, db));
    try {
      return !shotsDiffer(a.dataUrl, b.dataUrl, rec.region, masks);
    } catch (err) {
      log(`repeat check failed: ${err.message}`);
      return false;
    }
  }

  // Decides a held click, with `after` a shot taken once it had time to act
  // (the next action's own shot, or one taken now) and `at` the pointer then.
  async function settlePending(after, at) {
    const p = pendingClick;
    if (!p) return;
    pendingClick = null;
    clearTimeout(p.timer);
    const { record: cur, prev, display } = p;
    const sameKind = prev.kind === cur.kind;
    const idleBefore = sameKind && unchanged(prev.frame, cur.frame, cur, display, [prev, cur]);
    const idleAfter = sameKind && !idleBefore && after?.dataUrl && unchanged(cur.frame, after, cur, display, [cur, at]);
    if (idleBefore || idleAfter) {
      log(`dropped a repeated ${cur.kind} (${idleBefore ? 'no change since the last one' : 'it changed nothing'})`);
      lastClickStep = cur; // still the click the next one is compared with
      return;
    }
    await appendSteps([p.step]);
    lastClickStep = cur;
  }

  // Settles a held click with a fresh shot (from the pipeline, so it runs
  // after the click that set it). `framePromise` reuses a shot already taken
  // of the same display.
  function settleSoon(framePromise, displayId, point) {
    enqueue(async () => {
      const p = pendingClick;
      if (!p) return;
      const frame = framePromise && displayId === p.display.id ? await framePromise : await grab(p.display);
      if (pendingClick === p) await settlePending(frame, point || screen.getCursorScreenPoint());
    });
  }

  function holdClick(step, record, prev, display) {
    const p = { step, record, prev, display, timer: 0 };
    p.timer = setTimeout(() => pendingClick === p && settleSoon(), SETTLE_MS);
    pendingClick = p;
  }

  // ---------- typing ----------

  function startDraft() {
    if (pendingClick) settleSoon(); // typing: decide a held click before the screen fills with text
    draft ={ chars: '', lastKeyAt: Date.now(), field: null, snapshot: null, snapAt: 0, idle: 0, snap: 0, point: screen.getCursorScreenPoint() };
    const d = draft;
    d.fieldPromise = inspector.focused().then((f) => (d.field = f));
  }

  function onChar(ch) {
    if (!draft) startDraft();
    const d = draft;
    d.chars += ch;
    d.lastKeyAt = Date.now();
    clearTimeout(d.snap);
    clearTimeout(d.idle);
    // After a short pause, read the field's real value (handles autocorrect,
    // pasted text and keyboard layouts the keycode map can't know).
    d.snap = setTimeout(() => {
      inspector.focused().then((f) => {
        if (f) {
          d.snapshot = f;
          d.snapAt = Date.now();
        }
      });
    }, 600);
    d.idle = setTimeout(() => {
      if (draft === d) flushDraft();
    }, 1800);
  }

  // Ends the current typing run. `framePromise` lets a click or Enter share
  // its pre-action screenshot with the typing step.
  function flushDraft(framePromise) {
    const d = draft;
    if (!d) return;
    draft = null;
    clearTimeout(d.snap);
    clearTimeout(d.idle);
    if (!d.chars) return;
    const cursor = screen.getCursorScreenPoint();
    framePromise ||= grab(shotDisplay(cursor));
    enqueue(async () => {
      await Promise.race([d.fieldPromise, new Promise((r) => setTimeout(r, 800))]);
      const fresh = d.snapshot && d.snapAt >= d.lastKeyAt;
      const field = (fresh ? d.snapshot : d.field) || d.snapshot || null;
      if (isOwnElement(field, d.point)) return; // typing in FlowDoc's own UI
      if (!inScope(field)) return;
      const known = !!field && ['edit', 'document', 'combobox'].includes(String(field.type).toLowerCase());
      let value = null;
      if (!field?.isPassword && captureSettings.typedText !== false) {
        if (fresh && field?.value) value = field.value;
        else if (known || captureSettings.unknownFieldText) value = d.chars;
      }
      const text = describeTyping(field, value);
      const frame = await framePromise;
      const display =
        scope.mode === 'area' ? areaDisplay() : field?.rect ? displayAt(toDip({ x: field.rect.x + field.rect.w / 2, y: field.rect.y + field.rect.h / 2 })) : displayAt(cursor);
      const step = buildStep({ frame, display, el: field, action: 'type', text, extra: { value: field?.isPassword ? '' : value || '', secret: !!field?.isPassword } });

      // Continuing to type in the same field refines the previous step.
      const guide = await getGuide(state.guideId);
      const last = guide?.steps.at(-1);
      const sameField = last?.action === 'type' && last.fieldKey && last.fieldKey === fieldKey(field) && !keepIds?.has(last.id);
      step.fieldKey = fieldKey(field);
      await appendSteps([step], sameField ? { replaceId: last.id } : {});
    });
  }

  const fieldKey = (f) => (f ? `${f.app}|${f.window}|${f.name}|${f.rect ? `${Math.round(f.rect.x)},${Math.round(f.rect.y)}` : ''}` : '');

  // ---------- hook handlers ----------

  function onMouseDown(e) {
    if (!recording()) return;
    const point = toDip({ x: e.x, y: e.y });
    if (isOwnWindow(point)) return;
    const button = e.button; // 1 left, 2 right, 3 middle
    if (button !== 1 && button !== 2) return;
    const clicks = e.clicks || 1;
    if (scope.mode === 'area') {
      lastInArea = pointInArea(scope.area, point);
      if (!lastInArea) {
        if (draft) flushDraft(); // clicking elsewhere ends the typing run
        return;
      }
    }

    // Second press of a double-click: relabel the step just captured.
    if (button === 1 && clicks >= 2 && lastClick && Date.now() - lastClick.at < 800 && Math.hypot(point.x - lastClick.x, point.y - lastClick.y) < 8) {
      const prev = lastClick;
      lastClick = null;
      enqueue(async () => {
        const el = await prev.elPromise;
        const patch = { text: describeClick(el, { clicks: 2 }), action: 'dblclick' };
        const p = pendingClick;
        if (p?.step.id === prev.stepId) {
          // A held click became a double-click: judge it as one, from now.
          Object.assign(p.step, patch);
          p.record.kind = 'dblclick';
          clearTimeout(p.timer);
          p.timer = setTimeout(() => pendingClick === p && settleSoon(), SETTLE_MS);
          return;
        }
        await patchStep(prev.stepId, patch);
        if (lastClickStep?.stepId === prev.stepId) lastClickStep.kind = 'dblclick';
      });
      return;
    }

    const display = displayAt(point);
    const framePromise = grab(display);
    const elPromise = inspector.elementAt(e.x, e.y);
    settleSoon(framePromise, display.id, point); // this click's shot shows what a held click did
    if (draft) flushDraft(framePromise);
    const stepId = randomUUID();
    lastClick = { stepId, at: Date.now(), x: point.x, y: point.y, elPromise };
    enqueue(async () => {
      const [frame, el] = await Promise.all([framePromise, elPromise]);
      if (isOwnElement(el, point)) return; // a click on FlowDoc itself
      const step = buildStep({ frame, display, point, el, action: button === 2 ? 'rightclick' : 'click', text: describeClick(el, { button, clicks: 1 }) });
      step.id = stepId;
      if (!appAllowed(scope, el)) {
        lastClickStep = null;
        return noteStray(el, step);
      }
      const record = clickRecord(el, point, button, display, frame, stepId);
      // The same thing clicked again: held until it shows whether it did anything.
      if (sameTarget(lastClickStep, record)) return holdClick(step, record, lastClickStep, display);
      if (button === 1 && String(el?.type).toLowerCase() === 'tabitem') {
        const nav = await browserNavigation(el, display);
        if (nav) {
          await appendSteps([{ ...nav, id: stepId }]);
          lastClickStep = record;
          return;
        }
      }
      await appendSteps([step]);
      lastClickStep = record;
    });
  }

  function pressStep(label, e) {
    const cursor = screen.getCursorScreenPoint();
    const display = shotDisplay(cursor);
    const framePromise = grab(display);
    const elPromise = inspector.focused();
    settleSoon(framePromise, display.id);
    if (draft) flushDraft(framePromise);
    enqueue(async () => {
      const [frame, el] = await Promise.all([framePromise, elPromise]);
      if (!inScope(el)) return;
      const switching = TAB_KEYS.test(label) || (label === 'Enter' && isAddressBar(el));
      const nav = switching && (await browserNavigation(el, display, label === 'Enter' ? 1200 : 600));
      if (nav) return appendSteps([nav]);
      await appendSteps([buildStep({ frame, display, el, action: 'key', text: `Press ${b(label)}`, extra: { key: label } })]);
    });
  }

  function onKeyDown(e) {
    if (!recording()) return;
    const code = e.keycode;
    if (META.has(code)) {
      metaAlone = true;
      return;
    }
    if (MODIFIERS.has(code)) return;
    metaAlone = false;
    const ctrl = e.ctrlKey;
    const alt = e.altKey;
    const meta = e.metaKey;
    const keyName = KEY_NAMES.get(code) || `Key ${code}`;

    // AltGr (Ctrl+Alt) produces characters on many layouts; treat as typing.
    if ((ctrl || alt || meta) && !(ctrl && alt && !meta && CHAR.has(code))) {
      if (alt && e.shiftKey && code === K.R) return; // our own start/stop shortcut
      const combo = [ctrl && 'Ctrl', alt && 'Alt', e.shiftKey && 'Shift', meta && (win ? 'Win' : 'Super'), keyName].filter(Boolean).join('+');
      pressStep(combo, e);
      return;
    }
    if (code === K.Enter || code === K.NumpadEnter) return pressStep('Enter', e);
    if (code === K.Escape) return pressStep('Esc', e);
    if (code === K.Tab) {
      flushDraft();
      return;
    }
    if (code === K.Backspace) {
      if (draft) draft.chars = draft.chars.slice(0, -1);
      return;
    }
    if (PRESS_KEYS.has(code)) return pressStep(keyName, e);
    const ch = (e.shiftKey ? SHIFT_CHAR : CHAR).get(code);
    if (ch !== undefined) onChar(ch);
  }

  function onKeyUp(e) {
    if (!recording()) return;
    if (META.has(e.keycode) && metaAlone) {
      metaAlone = false;
      pressStep(win ? 'Windows key' : 'Super key', e);
    }
  }

  uIOhook.on('mousedown', onMouseDown);
  uIOhook.on('keydown', onKeyDown);
  uIOhook.on('keyup', onKeyUp);

  // ---------- session control ----------

  // `guideId` continues an existing guide: new steps go after its last one.
  // `scope` limits what is recorded (see scope.js); the guide remembers it.
  async function start({ title = '', guideId, scope: wanted } = {}) {
    if (state.active) return { ...state };
    captureSettings = (await settings.get()).capture;
    lastClickStep = null;
    clearTimeout(pendingClick?.timer);
    pendingClick = null;
    let guide = guideId ? await getGuide(guideId) : null;
    if (guideId && !guide) throw new Error('That guide no longer exists.');
    scope = cleanScope(wanted);
    if (scope.mode === 'area' && !(scope.area?.width > 0)) throw new Error('Choose the area to capture first.');
    if (scope.mode === 'apps' && !scope.apps.length) throw new Error('Choose at least one app to capture.');
    if (guide) {
      keepIds = new Set(guide.steps.map((s) => s.id));
      guide.recording = true;
    } else {
      keepIds = null;
      guide = createGuide({ title, recording: true, source: { app: 'Desktop', platform: process.platform } });
    }
    guide.captureScope = cleanScope(scope);
    await saveGuide(guide);
    await Promise.all([capture.start(), inspector.warmUp()]);
    const stepCount = guide.steps.filter((s) => s.kind === 'action').length;
    stray = null;
    muted.clear();
    appRects.clear();
    lastInArea = false;
    state = { active: true, paused: false, guideId: guide.id, stepCount, startedAt: Date.now(), continuing: !!keepIds, scope: cleanScope(scope) };
    if (!hookRunning && !process.env.FLOWDOC_NO_HOOK) {
      uIOhook.start();
      hookRunning = true;
    }
    emitState();
    log(`recording started (stream capture: ${capture.streaming}, inspector: ${inspector.available})`);
    return { ...state };
  }

  async function stop() {
    if (!state.active) return { ...state };
    flushDraft();
    settleSoon();
    const guideId = state.guideId;
    state.paused = true; // stop accepting new events while the queue drains
    await pipeline;
    if (hookRunning) {
      uIOhook.stop();
      hookRunning = false;
    }
    capture.stop();
    const guide = await getGuide(guideId);
    if (guide) {
      delete guide.recording;
      if (!guide.title) guide.title = desktopTitle(guide);
      await saveGuide(guide);
    }
    keepIds = null;
    state = { active: false, paused: false, guideId: null, stepCount: 0, startedAt: 0 };
    emitState();
    events.emit('finished', { guideId });
    return { ...state, lastGuideId: guideId };
  }

  async function discard() {
    if (!state.active) return { ...state };
    const guideId = state.guideId;
    draft = null;
    state.paused = true;
    await pipeline;
    clearTimeout(pendingClick?.timer);
    pendingClick = null;
    if (hookRunning) {
      uIOhook.stop();
      hookRunning = false;
    }
    capture.stop();
    if (keepIds) {
      // Continuing an existing guide: drop only this session's steps.
      const guide = await getGuide(guideId);
      if (guide) {
        guide.steps = guide.steps.filter((s) => keepIds.has(s.id));
        delete guide.recording;
        await saveGuide(guide);
      }
    } else {
      await deleteGuide(guideId);
    }
    keepIds = null;
    state = { active: false, paused: false, guideId: null, stepCount: 0, startedAt: 0 };
    emitState();
    return { ...state };
  }

  function setPaused(paused) {
    if (!state.active) return { ...state };
    if (paused) {
      flushDraft();
      settleSoon();
    }
    state.paused = paused;
    emitState();
    return { ...state };
  }

  // ---------- changing the scope while capturing ----------

  // Apps mode: the chosen apps, replaced as a whole.
  async function setApps(apps) {
    if (!state.active || scope.mode !== 'apps') return { ...state };
    const next = cleanScope({ mode: 'apps', apps }).apps;
    if (!next.length) throw new Error('Keep at least one app.');
    scope.apps = next;
    await saveScope();
    return { ...state };
  }

  // Apps mode: adds one app. If the user just clicked in it, that click is kept.
  async function includeApp({ key, name } = {}) {
    if (!state.active || scope.mode !== 'apps' || !key) return { ...state };
    if (!scope.apps.some((a) => a.key === key)) scope.apps.push({ key, name: name || key });
    muted.delete(key);
    const s = stray?.key === key && Date.now() - stray.at < 60000 ? stray : null;
    if (stray?.key === key) stray = null;
    await saveScope();
    if (s) await enqueue(() => insertStep(s.step));
    return { ...state };
  }

  // Apps mode: stop asking about an app for the rest of this capture.
  function dismissStray(key) {
    if (key) muted.add(key);
    if (stray?.key === key) stray = null;
  }

  async function setArea(area) {
    if (!state.active || scope.mode !== 'area') return { ...state };
    const next = cleanScope({ mode: 'area', area }).area;
    if (!(next?.width > 0)) return { ...state };
    if (draft) flushDraft();
    scope.area = next;
    lastInArea = false;
    await saveScope();
    return { ...state };
  }

  return {
    events,
    start,
    stop,
    discard,
    setPaused,
    setApps,
    includeApp,
    dismissStray,
    setArea,
    get state() {
      return { ...state };
    },
    // Used by the self-test to feed synthetic hook events.
    simulate: { mousedown: onMouseDown, keydown: onKeyDown, keyup: onKeyUp },
    // Tests: finish queued work, deciding a held click now.
    drain: () => {
      settleSoon();
      return pipeline;
    },
  };
}

export function desktopTitle(guide) {
  const apps = [];
  for (const s of guide.steps) {
    const a = s.app && s.app !== 'Windows Explorer' ? s.app : s.app === 'Windows Explorer' ? 'File Explorer' : '';
    if (a && !apps.includes(a)) apps.push(a);
  }
  if (!apps.length) return 'Untitled guide';
  return `Workflow in ${apps.slice(0, 2).join(' and ')}${apps.length > 2 ? ' and more' : ''}`;
}
