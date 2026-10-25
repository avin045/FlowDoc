// System-wide recorder. A global mouse/keyboard hook (uiohook) sees every
// click and key press in any application; each one is turned into a guide
// step with a screenshot (capture.js) and a description of the element that
// was acted on (inspector/). Steps are written to the same guide format the
// workspace and exporters already use.
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { screen } from 'electron';
import uiohookPkg from 'uiohook-napi';
import { createGuide, deleteGuide, getGuide, saveGuide } from '../extension/shared/guides.js';

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

export function createRecorder({ capture, inspector, settings, isOwnWindow, isOwnElement = () => false, widgetBounds, log = () => {} }) {
  const events = new EventEmitter();
  let state = { active: false, paused: false, guideId: null, stepCount: 0, startedAt: 0 };
  let pipeline = Promise.resolve();
  let draft = null;
  let metaAlone = false;
  let lastClick = null; // { stepId, at, x, y }
  let hookRunning = false;
  let captureSettings = {};

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
      crop: null,
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
    // The recorder bar can only be hidden from captures on Windows; elsewhere blur it.
    const wb = !win && widgetBounds?.();
    if (wb && frame && wb.x < db.x + db.width && wb.x + wb.width > db.x && wb.y < db.y + db.height && wb.y + wb.height > db.y) {
      step.redactions.push({ x: (wb.x - db.x) / db.width, y: (wb.y - db.y) / db.height, w: wb.width / db.width, h: wb.height / db.height });
    }
    return step;
  }

  async function appendSteps(steps, { replaceId } = {}) {
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

  // ---------- typing ----------

  function startDraft() {
    draft = { chars: '', lastKeyAt: Date.now(), field: null, snapshot: null, snapAt: 0, idle: 0, snap: 0, point: screen.getCursorScreenPoint() };
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
    framePromise ||= capture.grab(displayAt(cursor));
    enqueue(async () => {
      await Promise.race([d.fieldPromise, new Promise((r) => setTimeout(r, 800))]);
      const fresh = d.snapshot && d.snapAt >= d.lastKeyAt;
      const field = (fresh ? d.snapshot : d.field) || d.snapshot || null;
      if (isOwnElement(field, d.point)) return; // typing in FlowDoc's own UI
      const known = !!field && ['edit', 'document', 'combobox'].includes(String(field.type).toLowerCase());
      let value = null;
      if (!field?.isPassword && captureSettings.typedText !== false) {
        if (fresh && field?.value) value = field.value;
        else if (known || captureSettings.unknownFieldText) value = d.chars;
      }
      const text = describeTyping(field, value);
      const frame = await framePromise;
      const display = field?.rect ? displayAt(toDip({ x: field.rect.x + field.rect.w / 2, y: field.rect.y + field.rect.h / 2 })) : displayAt(cursor);
      const step = buildStep({ frame, display, el: field, action: 'type', text, extra: { value: field?.isPassword ? '' : value || '', secret: !!field?.isPassword } });

      // Continuing to type in the same field refines the previous step.
      const guide = await getGuide(state.guideId);
      const last = guide?.steps.at(-1);
      const sameField = last?.action === 'type' && last.fieldKey && last.fieldKey === fieldKey(field);
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

    // Second press of a double-click: relabel the step just captured.
    if (button === 1 && clicks >= 2 && lastClick && Date.now() - lastClick.at < 800 && Math.hypot(point.x - lastClick.x, point.y - lastClick.y) < 8) {
      const prev = lastClick;
      lastClick = null;
      enqueue(async () => {
        const el = await prev.elPromise;
        await patchStep(prev.stepId, { text: describeClick(el, { clicks: 2 }), action: 'dblclick' });
      });
      return;
    }

    const display = displayAt(point);
    const framePromise = capture.grab(display);
    const elPromise = inspector.elementAt(e.x, e.y);
    if (draft) flushDraft(framePromise);
    const stepId = randomUUID();
    lastClick = { stepId, at: Date.now(), x: point.x, y: point.y, elPromise };
    enqueue(async () => {
      const [frame, el] = await Promise.all([framePromise, elPromise]);
      if (isOwnElement(el, point)) return; // a click on FlowDoc itself
      const step = buildStep({ frame, display, point, el, action: button === 2 ? 'rightclick' : 'click', text: describeClick(el, { button, clicks: 1 }) });
      step.id = stepId;
      await appendSteps([step]);
    });
  }

  function pressStep(label, e) {
    const cursor = screen.getCursorScreenPoint();
    const display = displayAt(cursor);
    const framePromise = capture.grab(display);
    const elPromise = inspector.focused();
    if (draft) flushDraft(framePromise);
    enqueue(async () => {
      const [frame, el] = await Promise.all([framePromise, elPromise]);
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

  async function start({ title = '' } = {}) {
    if (state.active) return { ...state };
    captureSettings = (await settings.get()).capture;
    const guide = createGuide({ title, recording: true, source: { app: 'Desktop', platform: process.platform } });
    await saveGuide(guide);
    await Promise.all([capture.start(), inspector.warmUp()]);
    state = { active: true, paused: false, guideId: guide.id, stepCount: 0, startedAt: Date.now() };
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
    if (hookRunning) {
      uIOhook.stop();
      hookRunning = false;
    }
    capture.stop();
    await deleteGuide(guideId);
    state = { active: false, paused: false, guideId: null, stepCount: 0, startedAt: 0 };
    emitState();
    return { ...state };
  }

  function setPaused(paused) {
    if (!state.active) return { ...state };
    if (paused) flushDraft();
    state.paused = paused;
    emitState();
    return { ...state };
  }

  return {
    events,
    start,
    stop,
    discard,
    setPaused,
    get state() {
      return { ...state };
    },
    // Used by the self-test to feed synthetic hook events.
    simulate: { mousedown: onMouseDown, keydown: onKeyDown, keyup: onKeyUp },
    drain: () => pipeline,
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
