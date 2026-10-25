// FlowDoc service worker: owns the recording session, takes the screenshots
// and appends steps to the guide in storage. Everything that must survive the
// worker being suspended lives in chrome.storage, never in module variables.
import { createGuide, defaultTitle, deleteGuide, getGuide, saveGuide } from './shared/guides.js';

const STATE_KEY = 'recordingState';
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

async function addSteps(rawSteps, { windowId, page, capture: wantCapture = true }) {
  const state = await getState();
  if (!state.active || state.paused) return state;
  const shot = wantCapture ? await capture(windowId) : null;
  return enqueue(async () => {
    const current = await getState();
    if (!current.active || current.guideId !== state.guideId) return current;
    const guide = await getGuide(current.guideId);
    if (!guide) return current;
    for (const raw of rawSteps) {
      const existing = raw.id && guide.steps.find((s) => s.id === raw.id);
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
    await saveGuide(guide);
    const stepCount = guide.steps.filter((s) => s.kind === 'action').length;
    return setState({ ...current, stepCount });
  });
}

// ---------- session control ----------

async function start(tabId) {
  const state = await getState();
  if (state.active) return state;
  let tab = await chrome.tabs.get(tabId);
  // captureVisibleTab only sees the active tab, so bring the target forward.
  if (!tab.active) {
    tab = await chrome.tabs.update(tabId, { active: true });
    await new Promise((r) => setTimeout(r, 400)); // let it paint before the first capture
  }
  const guide = createGuide({ recording: true, source: { url: tab.url, title: tab.title } });
  await saveGuide(guide);
  await chrome.storage.local.set({ [STATE_KEY]: { active: true, paused: false, guideId: guide.id, stepCount: 0 } });

  // The opening "Navigate to" step is captured before the recorder widget appears.
  if (/^(https?|file):/.test(tab.url || '')) {
    let host = tab.url;
    try {
      host = new URL(tab.url).hostname || tab.url;
    } catch {}
    await addSteps(
      [{ action: 'navigate', text: `Navigate to **${host}**`, href: tab.url }],
      { windowId: tab.windowId, page: { url: tab.url, title: tab.title } },
    );
  }
  await ensureContentScript(tabId);
  return setState({ ...(await getState()) });
}

async function stop({ open = true } = {}) {
  const state = await getState();
  if (!state.active) return state;
  await enqueue(async () => {
    const guide = await getGuide(state.guideId);
    if (!guide) return;
    delete guide.recording;
    if (!guide.title) guide.title = defaultTitle(guide);
    await saveGuide(guide);
  });
  await setState(IDLE);
  if (open) await chrome.tabs.create({ url: chrome.runtime.getURL(`app.html#/guide/${state.guideId}`) });
  return { ...IDLE, lastGuideId: state.guideId };
}

async function discard() {
  const state = await getState();
  if (!state.active) return state;
  await enqueue(() => deleteGuide(state.guideId));
  return setState(IDLE);
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
        return start(msg.tabId);
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

chrome.runtime.onStartup.addListener(async () => {
  // A browser restart ends any recording that was in progress.
  const state = await getState();
  if (state.active) await stop({ open: false });
});
