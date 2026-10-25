// FlowDoc desktop (Windows + Linux). Hosts the same workspace UI as the
// browser extension, but records clicks and keystrokes in every application
// (file manager, browsers, Office, settings...) instead of one browser tab.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, screen, session, shell, Tray } from 'electron';
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setKv } from '../extension/shared/guides.js';
import { complete, listModels } from './ai.js';
import { listChildPages, listPages, pathTo, saveGuide as saveToNotion, whoAmI } from './notion.js';
import { createCapture } from './capture.js';
import { createInspector } from './inspector/index.js';
import { createRecorder } from './recorder.js';
import { createSettings } from './settings.js';
import { createFileStore } from './store.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const SHORTCUT = 'Alt+Shift+R';
const log = (...args) => console.log('[FlowDoc]', ...args);

if (process.env.FLOWDOC_USER_DATA) app.setPath('userData', process.env.FLOWDOC_USER_DATA);
migrateFromStepCraft();
if (!app.requestSingleInstanceLock()) app.quit();

// FlowDoc was called StepCraft, so its data lived in %APPDATA%\stepcraft (dev)
// or %APPDATA%\StepCraft (installed). Copy guides, settings and the key file
// that decrypts saved API keys ("Local State") into the new folder once,
// before Chromium opens the profile. The old folder is left as a backup.
function migrateFromStepCraft() {
  const target = app.getPath('userData');
  if (existsSync(join(target, 'library'))) return;
  const candidates = process.env.FLOWDOC_LEGACY_DIR
    ? [process.env.FLOWDOC_LEGACY_DIR]
    : process.env.FLOWDOC_USER_DATA
      ? []
      : ['stepcraft', 'StepCraft'].map((name) => join(app.getPath('appData'), name));
  const legacy = candidates.find((dir) => existsSync(join(dir, 'library')));
  if (!legacy) return;
  try {
    mkdirSync(target, { recursive: true });
    cpSync(join(legacy, 'library'), join(target, 'library'), { recursive: true });
    for (const file of ['settings.json', 'Local State']) {
      if (existsSync(join(legacy, file)) && !existsSync(join(target, file))) copyFileSync(join(legacy, file), join(target, file));
    }
    console.log(`[FlowDoc] moved guides and settings from ${legacy}`);
  } catch (err) {
    console.error(`[FlowDoc] could not copy data from ${legacy}: ${err.message}`);
  }
}

// The workspace is served from app://flowdoc/ so ES modules load normally.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

let mainWin = null;
let widgetWin = null;
let tray = null;
let quitting = false;

const store = createFileStore(join(app.getPath('userData'), 'library'), {
  onChange: (key, source) => {
    if (source !== 'ui' && mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('kv:changed', { key });
  },
});
setKv(store);
const settings = createSettings(join(app.getPath('userData'), 'settings.json'));
const capture = createCapture({ dir: here, log });
const inspector = createInspector({ log });

// Clicks on FlowDoc's own windows are not steps. The self-test's demo window
// is the one exception: it stands in for "another app".
const capturableWindows = new WeakSet();

const contains = (w, p) => {
  const r = w.getBounds();
  return p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y < r.y + r.height;
};
const insideCapturable = (p) =>
  BrowserWindow.getAllWindows().some((w) => capturableWindows.has(w) && w.isVisible() && !w.isMinimized() && contains(w, p));

// Fast check at mouse-down time: the recorder bar, or a FlowDoc window that
// has focus. (A visible-but-background FlowDoc window may be covered by the
// app being recorded, so bounds alone aren't enough.)
function isOwnWindow(point) {
  if (insideCapturable(point)) return false;
  if (widgetWin?.isVisible() && contains(widgetWin, point)) return true;
  const focused = BrowserWindow.getFocusedWindow();
  return !!focused && !capturableWindows.has(focused) && contains(focused, point);
}

// Slower check once the inspector has answered: the element belongs to us.
function isOwnElement(el, point) {
  if (!el?.pid || (point && insideCapturable(point))) return false;
  return app.getAppMetrics().some((m) => m.pid === el.pid);
}

const recorder = createRecorder({
  capture,
  inspector,
  settings,
  isOwnWindow,
  isOwnElement,
  widgetBounds: () => (widgetWin && widgetWin.isVisible() ? widgetWin.getBounds() : null),
  log,
});

// ---------- windows ----------

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 420,
    minHeight: 500,
    title: 'FlowDoc',
    icon: join(root, 'extension/icons/icon128.png'),
    // Matches the page background of the chosen theme, so there's no white flash.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b1120' : '#f6f7fb',
    autoHideMenuBar: true,
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  mainWin.loadURL('app://flowdoc/app.html');
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    // Print preview opens the guide as a blob: page in a child window.
    if (url.startsWith('blob:') || url.startsWith('app://')) return { action: 'allow' };
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.on('close', (e) => {
    if (recorder.state.active && !quitting) {
      e.preventDefault();
      mainWin.minimize();
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
    // The hidden recorder bar keeps a window alive, so quit explicitly.
    if (!recorder.state.active) app.quit();
  });
}

function createWidget() {
  widgetWin = new BrowserWindow({
    width: 460,
    height: 60,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    show: false,
    hasShadow: false,
    webPreferences: { preload: join(here, 'widget-preload.cjs'), contextIsolation: true, sandbox: true },
  });
  widgetWin.setAlwaysOnTop(true, 'screen-saver');
  // Keeps the recorder bar out of screenshots (Windows 10 2004+ and macOS).
  widgetWin.setContentProtection(true);
  widgetWin.loadFile(join(here, 'widget.html'));
}

function placeWidget() {
  const area = screen.getPrimaryDisplay().workArea;
  const [w, h] = widgetWin.getSize();
  widgetWin.setPosition(Math.round(area.x + (area.width - w) / 2), Math.round(area.y + area.height - h - 12));
}

function broadcast(channel, payload) {
  for (const w of [mainWin, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---------- recording ----------

async function startRecording(opts = {}) {
  if (recorder.state.active) return recorder.state;
  const { capture: cap } = await settings.get();
  if (cap.hideWindow && mainWin && !process.env.FLOWDOC_SELFTEST) mainWin.minimize();
  const state = await recorder.start(opts);
  placeWidget();
  widgetWin.showInactive();
  return state;
}

recorder.events.on('state', (state) => {
  broadcast('recorder:state', state);
  updateTray(state);
});

recorder.events.on('finished', ({ guideId }) => {
  widgetWin?.hide();
  if (!mainWin) createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
  mainWin.webContents.send('recorder:finished', { guideId });
});

function updateTray(state = recorder.state) {
  if (!tray) return;
  tray.setToolTip(state.active ? `FlowDoc — capturing (${state.stepCount} steps)` : 'FlowDoc');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      state.active
        ? { label: `Stop capture (${state.stepCount} steps)`, click: () => recorder.stop() }
        : { label: 'Start capture', accelerator: SHORTCUT, click: () => startRecording() },
      ...(state.active ? [{ label: state.paused ? 'Resume' : 'Pause', click: () => recorder.setPaused(!state.paused) }] : []),
      { type: 'separator' },
      { label: 'Open FlowDoc', click: () => (mainWin ? (mainWin.restore(), mainWin.show()) : createMainWindow()) },
      { label: 'Quit', role: 'quit' },
    ]),
  );
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('kv:get', (_e, key) => store.get(key));
  ipcMain.handle('kv:set', (_e, key, value) => store.set(key, value, { source: 'ui' }));
  ipcMain.handle('kv:remove', (_e, key) => store.remove(key, { source: 'ui' }));

  ipcMain.handle('recorder:start', (_e, opts) => startRecording(opts));
  ipcMain.handle('recorder:stop', () => recorder.stop());
  ipcMain.handle('recorder:discard', async () => {
    const s = await recorder.discard();
    widgetWin?.hide();
    if (mainWin) {
      mainWin.restore();
      mainWin.show();
    }
    return s;
  });
  ipcMain.handle('recorder:pause', () => recorder.setPaused(true));
  ipcMain.handle('recorder:resume', () => recorder.setPaused(false));
  ipcMain.handle('recorder:state', () => recorder.state);

  ipcMain.handle('settings:get', () => settings.getPublic());
  ipcMain.handle('settings:update', (_e, patch) => settings.update(patch));
  ipcMain.handle('settings:setKey', (_e, provider, key) => settings.setKey(provider, key));

  ipcMain.handle('ai:complete', async (_e, req) => {
    const s = await settings.get();
    const provider = req.provider || s.ai.provider;
    if (!provider || provider === 'off') throw new Error('AI is turned off. Choose a provider in Settings.');
    const apiKey = await settings.getKey(provider);
    return complete({ ...req, provider, apiKey, model: req.model || s.ai.models[provider] });
  });
  ipcMain.handle('ai:listModels', async (_e, provider) => listModels(provider, await settings.getKey(provider)));

  ipcMain.handle('notion:me', async () => whoAmI(await settings.getKey('notion')));
  ipcMain.handle('notion:pages', async (_e, query) => listPages(await settings.getKey('notion'), query || ''));
  ipcMain.handle('notion:children', async (_e, pageId) => listChildPages(await settings.getKey('notion'), pageId));
  ipcMain.handle('notion:path', async (_e, pageId) => pathTo(await settings.getKey('notion'), pageId));
  // Named locations: at most 10, one per page, short names.
  ipcMain.handle('notion:setSaved', async (_e, list) => {
    const seen = new Set();
    const saved = (Array.isArray(list) ? list : [])
      .filter((x) => x?.id && !seen.has(x.id) && seen.add(x.id))
      .map((x) => ({ name: String(x.name || x.title || 'Untitled').trim().slice(0, 40), id: x.id, title: x.title, path: x.path, crumbs: x.crumbs }));
    if (saved.length > 10) throw new Error('You can keep up to 10 saved locations. Remove one first.');
    return settings.update({ notion: { saved } });
  });
  ipcMain.handle('notion:save', async (e, req) => {
    const token = await settings.getKey('notion');
    const result = await saveToNotion(token, req, (p) => !e.sender.isDestroyed() && e.sender.send('notion:progress', p));
    // Remember the destination under Recent (newest first, 5 kept).
    if (req.location?.id) {
      const prev = (await settings.get()).notion.recents || [];
      const recents = [{ ...req.location, usedAt: Date.now() }, ...prev.filter((r) => r.id !== req.location.id)].slice(0, 5);
      await settings.update({ notion: { recents } });
    }
    return result;
  });
  ipcMain.on('theme:set', (_e, mode) => {
    const source = mode === 'light' || mode === 'dark' ? mode : 'system';
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
    mainWin?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0b1120' : '#f6f7fb');
    settings.update({ ui: { theme: source } }).catch(() => {});
  });
  ipcMain.handle('shell:openExternal', (_e, url) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url);
  });
}

// ---------- app lifecycle ----------

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    const base = rel.startsWith('demo') ? root : join(root, 'extension');
    const file = join(base, rel);
    if (!file.startsWith(root)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  registerIpc();
  // Apply the saved theme before the first window paints.
  nativeTheme.themeSource = (await settings.get()).ui?.theme || 'system';
  createMainWindow();
  createWidget();

  try {
    tray = new Tray(nativeImage.createFromPath(join(root, 'extension/icons/icon32.png')));
    tray.on('click', () => (mainWin ? (mainWin.restore(), mainWin.show()) : createMainWindow()));
    updateTray();
  } catch (err) {
    log(`tray unavailable: ${err.message}`);
  }

  globalShortcut.register(SHORTCUT, () => (recorder.state.active ? recorder.stop() : startRecording()));
  inspector.start(); // warm up the accessibility helper in the background

  if (process.env.FLOWDOC_SELFTEST) {
    const { runSelfTest } = await import('./selftest.js');
    runSelfTest({ app, mainWin, recorder, startRecording, settings, markCapturable: (w) => capturableWindows.add(w), getWidget: () => widgetWin }).catch((err) => {
      console.error(err);
      app.exit(1);
    });
  }
});

app.on('second-instance', () => {
  if (!mainWin) return createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
});

app.on('before-quit', async (e) => {
  quitting = true;
  if (recorder.state.active) {
    e.preventDefault();
    await recorder.stop();
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  inspector.stop();
});

app.on('window-all-closed', () => {
  if (!recorder.state.active) app.quit();
});
