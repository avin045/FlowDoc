// FlowDoc service worker: owns the recording session, takes the screenshots
// and appends steps to the guide in storage. Everything that must survive the
// worker being suspended lives in chrome.storage, never in module variables.
import { createGuide, defaultTitle, deleteGuide, getGuide, saveGuide } from './shared/guides.js';

const STATE_KEY = 'recordingState';
const CAPTURE_KEY = 'flowdoc_capture'; // capture settings, written by the workspace's Settings
const IDLE = { active: false, paused: false, guideId: null, stepCount: 0 };

// ---------- serialisation helpers ----------

// All guide mutations go through one queue so concurrent step messages can't
// overwrite each other's writes.
let writeQueue = Promise.resolve();
function enqueue(fn) {
  const run = writeQueue.then(() => fn());
  writeQueue = run.catch((err) => console.error('[FlowDoc]', err));
  return run;
}

// captureVisibleTab is rate limited (~2 calls/second), so captures are spaced out.
let captureChain = Promise.resolve();
let lastCaptureAt = 0;
function capture(windowId) {
  const run = captureChain.then(async () => {
    const wait = lastCaptureAt + 550 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCaptureAt = Date.now();
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 88 });
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
      const shot = { dataUrl, width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return shot;
    } catch (err) {
      // Restricted pages (chrome://, the Web Store, PDFs) can't be captured.
      console.warn('[FlowDoc] screenshot failed:', err?.message || err);
      return null;
    }
  });
  captureChain = run.catch(() => {});
  return run;
}

// ---------- state ----------

async function getState() {
  return (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] || IDLE;
}

async function setState(state) {
  await chrome.storage.local.set({ [STATE_KEY]: state });
  await updateBadge(state);
  await broadcast({ type: 'state', state });
  return state;
}

async function updateBadge(state) {
  if (!state.active) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: state.paused ? '#64748b' : '#e11d48' });
  await chrome.action.setBadgeText({ text: state.paused ? '❚❚' : String(state.stepCount || 'REC') });
}

async function broadcast(message) {
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})));
}

async function ensureContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // Pages the extension may not script (chrome://, Web Store). Steps on them are skipped.
  }
}

// The recorder script runs only while a capture is on: registered for pages
// that load meanwhile, and put into a tab when it's switched to. Outside a
// capture no page runs any FlowDoc code.
const RECORDER_SCRIPT = 'flowdoc-recorder';
async function registerRecorder() {
  try {
    const found = await chrome.scripting.getRegisteredContentScripts({ ids: [RECORDER_SCRIPT] });
    if (found.length) return;
    await chrome.scripting.registerContentScripts([
      { id: RECORDER_SCRIPT, matches: ['<all_urls>'], js: ['content.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: false },
    ]);
  } catch (err) {
    console.warn('[FlowDoc] could not register the recorder script:', err?.message || err);
  }
}
async function unregisterRecorder() {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [RECORDER_SCRIPT] });
  } catch {
    // not registered
  }
}

// ---------- password fields ----------

// Covers a box with the colour just outside its corners (the page around the
// field), with a thin outline so a reader still sees a field there. Nothing
// inside the box is used, so nothing about the password (characters, dots,
// how many) survives.
function coverBox(g, b) {
  const W = g.canvas.width;
  const H = g.canvas.height;
  const at = (x, y) => g.getImageData(Math.min(W - 1, Math.max(0, x)), Math.min(H - 1, Math.max(0, y)), 1, 1).data;
  const corners = [at(b.x, b.y), at(b.x + b.w - 1, b.y), at(b.x, b.y + b.h - 1), at(b.x + b.w - 1, b.y + b.h - 1)];
  const rgb = [0, 1, 2].map((i) => Math.round(corners.reduce((sum, c) => sum + c[i], 0) / corners.length));
  g.fillStyle = `rgb(${rgb.join(",")})`;
  g.fillRect(b.x, b.y, b.w, b.h);
  const line = Math.max(1, Math.round(b.h / 30));
  g.strokeStyle = 'rgba(100, 116, 139, 0.8)';
  g.lineWidth = line;
  g.strokeRect(b.x + line * 2, b.y + line * 2, b.w - line * 4, b.h - line * 4);
}

// The password-field boxes a page reported (viewport CSS pixels), as image
// pixels. Only well-formed boxes, at most 20: the message comes from a web
// page's tab, so it is checked like any input.
function secretBoxes(rects, viewport, shot) {
  if (!Array.isArray(rects) || !shot?.width) return [];
  const vw = Number(viewport?.w);
  const k = shot.width / (vw > 0 ? vw : shot.width);
  const ok = (n) => typeof n === 'number' && Number.isFinite(n);
  return rects
    .slice(0, 20)
    .filter((r) => r && ok(r.x) && ok(r.y) && ok(r.w) && ok(r.h) && r.w > 0 && r.h > 0)
    .map((r) => {
      const x = Math.max(0, Math.floor(r.x * k));
      const y = Math.max(0, Math.floor(r.y * k));
      return { x, y, w: Math.min(shot.width - x, Math.ceil(r.w * k)), h: Math.min(shot.height - y, Math.ceil(r.h * k)) };
    })
    .filter((b) => b.w > 0 && b.h > 0);
}

// Covers the password fields in the screenshot itself, before anything is
// stored: the original pixels never reach the guide. If that fails, the step
// gets no screenshot at all rather than one showing a password.
async function hideSecrets(shot, rects, viewport) {
  if (!shot?.dataUrl) return shot;
  const boxes = secretBoxes(rects, viewport, shot);
  if (!boxes.length) return shot;
  try {
    const img = await createImageBitmap(await (await fetch(shot.dataUrl)).blob());
    const c = new OffscreenCanvas(img.width, img.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    img.close();
    for (const b of boxes) coverBox(g, b);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { ...shot, dataUrl: `data:image/jpeg;base64,${btoa(bin)}`, secretsHidden: boxes.length };
  } catch (err) {
    console.warn('[FlowDoc] could not hide password fields; the step is kept without its screenshot:', err?.message || err);
    return null;
  }
}

// ---------- steps ----------

function buildStep(raw, shot, page) {
  return {
    kind: 'action',
    highlight: true,
    redactions: [],
    crop: null,
    createdAt: Date.now(),
    ...raw,
    url: page?.url || raw.url || '',
    pageTitle: page?.title || raw.pageTitle || '',
    screenshot: shot?.dataUrl || null,
    ...(shot?.secretsHidden ? { secretsHidden: shot.secretsHidden } : {}),
    shot: shot
      ? {
          width: shot.width,
          height: shot.height,
          viewportW: page?.viewport?.w || shot.width,
          viewportH: page?.viewport?.h || shot.height,
        }
      : null,
  };
}

// ---------- repeated clicks ----------

// Whether two screenshots differ. Strict on purpose: a few dozen changed
// pixels (a counter going from 1 to 2) count, so only identical screens match.
async function shotsDiffer(a, b) {
  const [ia, ib] = await Promise.all([a, b].map(async (url) => createImageBitmap(await (await fetch(url)).blob())));
  try {
    if (ia.width !== ib.width || ia.height !== ib.height) return true;
    const pixels = (img) => {
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    };
    const pa = pixels(ia);
    const pb = pixels(ib);
    let changed = 0;
    for (let i = 0; i < pa.length; i += 4) {
      if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 48 && ++changed > 40) return true;
    }
    return false;
  } finally {
    ia.close();
    ib.close();
  }
}

const sameShots = async (a, b) => {
  if (!a || !b) return false;
  try {
    return !(await shotsDiffer(a, b));
  } catch (err) {
    console.warn('[FlowDoc] repeat check failed:', err?.message || err);
    return false;
  }
};

// A click on the same element as the click before it comes `hold`: its
// screenshot is kept here, and the page settles it at its next action (or
// 1.5 s later) with what it saw. It is dropped when the page saw no change
// between the two clicks and the screenshots agree, or when the page saw no
// change after it and neither did the screen. Only ever held briefly.
// Settings > Capture > "Ignore repeated clicks that change nothing".
const held = new Map(); // id -> { raw, shot, page, timer }

async function ignoringRepeats() {
  const { [CAPTURE_KEY]: settings } = await chrome.storage.local.get(CAPTURE_KEY);
  return settings?.ignoreRepeats !== false;
}

function hold(raw, shot, page) {
  const id = raw.id;
  // If the page never settles it (it closed, say), the click is kept.
  const timer = setTimeout(() => {
    if (!held.has(id)) return;
    enqueue(async () => {
      const state = await getState();
      const guide = state.active && (await getGuide(state.guideId));
      if (!guide || !commitHeld(guide)) return;
      await saveGuide(guide);
      await setState({ ...state, stepCount: guide.steps.filter((s) => s.kind === 'action').length });
    });
  }, 6000);
  held.set(id, { raw: { createdAt: Date.now(), ...raw }, shot, page, timer });
}

// Keeps every held click (in the queue, with `guide` loaded). Whether any were.
function commitHeld(guide) {
  const any = held.size > 0;
  for (const h of held.values()) {
    clearTimeout(h.timer);
    guide.steps.push(buildStep(h.raw, h.shot, h.page));
  }
  held.clear();
  return any;
}

// Decides one held click; `after` is a screenshot taken at the next action.
async function settleHeld(guide, settle, after) {
  const h = held.get(settle.id);
  if (!h) return null;
  held.delete(settle.id);
  clearTimeout(h.timer);
  if (settle.sameKind && h.shot) {
    const last = guide.steps.at(-1);
    if (settle.idleBefore && settle.prevIds?.includes(last?.id) && (await sameShots(last.screenshot, h.shot.dataUrl))) return 'dropped';
    if (settle.idleAfter && after && (await sameShots(h.shot.dataUrl, after.dataUrl))) return 'dropped';
  }
  guide.steps.push(buildStep(h.raw, h.shot, h.page));
  return 'kept';
}

// Step messages reach the write queue in the order they arrived, even when an
// earlier one is still waiting for its screenshot (a double-click's second
// press must come after its first).
let arrival = Promise.resolve();

async function addSteps(rawSteps, opts) {
  const prior = arrival;
  let release;
  arrival = new Promise((r) => (release = r));
  try {
    return await addStepsInTurn(rawSteps, opts, prior);
  } finally {
    release();
  }
}

async function addStepsInTurn(rawSteps, { windowId, page, capture: wantCapture = true, settle = null }, prior) {
  const state = await getState();
  if (!state.active || state.paused) return state;
  const shot = wantCapture ? await hideSecrets(await capture(windowId), page?.secrets, page?.viewport) : null;
  const holding = rawSteps.some((r) => r.hold) && (await ignoringRepeats());
  await prior;
  return enqueue(async () => {
    const current = await getState();
    if (!current.active || current.guideId !== state.guideId) return current;
    const guide = await getGuide(current.guideId);
    if (!guide) return current;
    const dropped = [];
    let changed = false;
    if (settle) {
      const result = await settleHeld(guide, settle, shot);
      if (result === 'dropped') dropped.push(settle.id);
      changed = result === 'kept';
    }
    // Any other new step comes after clicks still held (from another tab, say).
    if (rawSteps.some((r) => !r.relabel) && commitHeld(guide)) changed = true;
    for (const { hold: wantsHold, relabel, ...raw } of rawSteps) {
      if (wantsHold && holding && shot) {
        hold(raw, shot, page);
        continue;
      }
      const waiting = raw.id && held.get(raw.id);
      if (waiting) {
        Object.assign(waiting.raw, raw); // a held click became a double-click
        continue;
      }
      const existing = raw.id && guide.steps.find((s) => s.id === raw.id);
      // A double-click on a click that was dropped as a repeat: nothing to relabel.
      if (!existing && relabel) continue;
      changed = true;
      if (existing) {
        // Upsert: typing drafts and double-clicks refine a step already captured.
        Object.assign(existing, raw);
        if (shot) {
          existing.screenshot = shot.dataUrl;
          existing.shot = buildStep(raw, shot, page).shot;
        }
      } else {
        guide.steps.push(buildStep({ id: raw.id || crypto.randomUUID(), ...raw }, shot, page));
      }
    }
    if (!changed) return { ...current, dropped };
    await saveGuide(guide);
    const stepCount = guide.steps.filter((s) => s.kind === 'action').length;
    return { ...(await setState({ ...current, stepCount })), dropped };
  });
}

// ---------- session control ----------

// `guideId` continues an existing guide ("Continue capturing"): new steps go
// after its last one, and Discard removes only those.
async function start(tabId, { guideId } = {}) {
  const state = await getState();
  if (state.active) return state;
  const existing = guideId ? await getGuide(guideId) : null;
  if (guideId && !existing) throw new Error('That guide no longer exists.');
  let tab = await chrome.tabs.get(tabId);
  // captureVisibleTab only sees the active tab, so bring the target forward.
  if (!tab.active) {
    tab = await chrome.tabs.update(tabId, { active: true });
    await new Promise((r) => setTimeout(r, 400)); // let it paint before the first capture
  }
  const guide = existing || createGuide({ source: { url: tab.url, title: tab.title } });
  guide.recording = true;
  await saveGuide(guide);
  const keepIds = existing ? existing.steps.map((s) => s.id) : null;
  const stepCount = guide.steps.filter((s) => s.kind === 'action').length;
  await chrome.storage.local.set({ [STATE_KEY]: { active: true, paused: false, guideId: guide.id, stepCount, keepIds } });

  // The opening "Navigate to" step is captured before the recorder widget
  // appears. A continued guide only gets one when the page has changed.
  const lastUrl = existing?.steps.findLast((s) => s.url)?.url;
  if (/^(https?|file):/.test(tab.url || '') && (!existing || lastUrl !== tab.url)) {
    let host = tab.url;
    try {
      host = new URL(tab.url).hostname || tab.url;
    } catch {}
    await addSteps(
      [{ action: 'navigate', text: `Navigate to **${host}**`, href: tab.url }],
      { windowId: tab.windowId, page: { url: tab.url, title: tab.title } },
    );
  }
  await registerRecorder();
  await ensureContentScript(tabId);
  return setState({ ...(await getState()) });
}

async function stop({ open = true } = {}) {
  const state = await getState();
  if (!state.active) return state;
  await enqueue(async () => {
    const guide = await getGuide(state.guideId);
    if (!guide) return;
    commitHeld(guide); // stopped from the toolbar or shortcut while a click was held
    delete guide.recording;
    if (!guide.title) guide.title = defaultTitle(guide);
    await saveGuide(guide);
  });
  await setState(IDLE);
  await unregisterRecorder();
  if (open) await chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#/guide/${state.guideId}`) });
  return { ...IDLE, lastGuideId: state.guideId };
}

async function discard() {
  const state = await getState();
  if (!state.active) return state;
  await enqueue(async () => {
    for (const h of held.values()) clearTimeout(h.timer);
    held.clear();
    if (!state.keepIds) return deleteGuide(state.guideId);
    // A continued guide keeps the steps it had before this capture.
    const guide = await getGuide(state.guideId);
    if (!guide) return;
    const keep = new Set(state.keepIds);
    guide.steps = guide.steps.filter((s) => keep.has(s.id));
    delete guide.recording;
    await saveGuide(guide);
  });
  const idle = await setState(IDLE);
  await unregisterRecorder();
  return idle;
}

async function setPaused(paused) {
  const state = await getState();
  if (!state.active) return state;
  return setState({ ...state, paused });
}

// Exposed for the popup, the keyboard shortcut and the end-to-end tests.
self.flowdoc = { start, stop, discard, setPaused, getState };

// ---------- events ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    switch (msg?.type) {
      case 'getState':
        return getState();
      case 'start':
        return start(msg.tabId, { guideId: msg.guideId });
      case 'stop':
        return stop();
      case 'discard':
        return discard();
      case 'pause':
        return setPaused(true);
      case 'resume':
        return setPaused(false);
      case 'steps':
        if (!sender.tab) return getState();
        return addSteps(msg.steps, {
          windowId: sender.tab.windowId,
          page: msg.page,
          capture: msg.capture !== false,
          settle: msg.settle || null,
        });
      default:
        return null;
    }
  };
  handle().then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
  return true; // keep the channel open for the async response
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-recording') return;
  const state = await getState();
  if (state.active) return stop();
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab) return start(tab.id);
});

// URLs typed into the address bar become "Navigate to" steps.
const typedNavigations = new Map();
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  if (['typed', 'auto_bookmark', 'generated', 'keyword'].includes(details.transitionType)) {
    typedNavigations.set(details.tabId, details.url);
  }
});
chrome.webNavigation.onCompleted.addListener(async (details) => {
  if (details.frameId !== 0 || !typedNavigations.has(details.tabId)) return;
  typedNavigations.delete(details.tabId);
  const state = await getState();
  if (!state.active || state.paused) return;
  const tab = await chrome.tabs.get(details.tabId);
  if (!tab.active) return;
  await addSteps([{ action: 'navigate', text: `Navigate to **${details.url}**`, href: details.url }], {
    windowId: tab.windowId,
    page: { url: tab.url, title: tab.title },
  });
});

// Switching to another tab (or browser window) becomes a "Navigate to" step
// with that page's link, unless the guide's last step is already on that page.
function loadedTab(tabId) {
  return new Promise((resolve) => {
    const done = (tab) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    const listener = (id, change, tab) => id === tabId && change.status === 'complete' && done(tab);
    const timer = setTimeout(() => chrome.tabs.get(tabId).then(done, () => done(null)), 8000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function tabSwitched(tabId) {
  if (!(await getState()).active) return;
  let tab = await chrome.tabs.get(tabId).catch(() => null);
  // A new, empty tab: the address typed into it becomes the step (see below).
  if (!/^(https?|file):/.test(tab?.pendingUrl || tab?.url || '')) return;
  if (tab.status === 'loading') tab = await loadedTab(tabId);
  const state = await getState();
  if (!state.active || !tab?.active || !/^(https?|file):/.test(tab.url || '')) return;
  // A tab that was open before the capture began doesn't have the recorder yet.
  await ensureContentScript(tab.id);
  if (state.paused) return;
  const guide = await getGuide(state.guideId);
  if (guide?.steps.findLast((s) => s.url)?.url === tab.url) return;
  await new Promise((r) => setTimeout(r, 300)); // let the tab paint before the screenshot
  await addSteps([{ action: 'navigate', text: `Navigate to **${tab.url}**`, href: tab.url }], {
    windowId: tab.windowId,
    page: { url: tab.url, title: tab.title },
  });
}

chrome.tabs.onActivated.addListener(({ tabId }) => tabSwitched(tabId));
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const [tab] = await chrome.tabs.query({ active: true, windowId }).catch(() => []);
  if (tab) tabSwitched(tab.id);
});

chrome.runtime.onStartup.addListener(async () => {
  // A browser restart ends any recording that was in progress.
  const state = await getState();
  if (state.active) await stop({ open: false });
});

// After an update or reload: the recorder script belongs to a capture in progress only.
chrome.runtime.onInstalled.addListener(async () => {
  if ((await getState()).active) await registerRecorder();
  else await unregisterRecorder();
});
