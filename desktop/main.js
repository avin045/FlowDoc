// FlowDoc desktop (Windows + Linux). Hosts the same workspace UI as the
// browser extension, but records clicks and keystrokes in every application
// (file manager, browsers, Office, settings...) instead of one browser tab.
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, screen, session, shell, Tray } from 'electron';
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setKv } from '../extension/shared/guides.js';
import { complete, listModels } from './ai.js';
import { listChildPages, listPages, normalizeSaved, pathTo, saveGuide as saveToNotion, whoAmI, withRecent } from './notion.js';
import { createAreaFrame, createAreaPicker } from './area.js';
import { createCapture } from './capture.js';
import { createInspector } from './inspector/index.js';
import { createRecorder } from './recorder.js';
import { groupApps } from './scope.js';
import { createSettings } from './settings.js';
import { createFileStore, ensureWritable, folderUsable, inspectFolder, mergeLibrary } from './store.js';

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

// Guides live here unless the user picks their own folder in Settings.
const DEFAULT_LIBRARY = join(app.getPath('userData'), 'library');
// Set when the chosen folder can't be reached at startup (e.g. an unplugged
// drive): FlowDoc then uses the default folder and says so.
let storageFallback = null;

const store = createFileStore(DEFAULT_LIBRARY, {
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

// A bar that other apps may see is hidden from captures for the moment
// FlowDoc takes a shot, so it stays out of the guide (others see it blink).
// Counted, because shots can overlap.
let barCovers = 0;
const barCover = {
  hide() {
    if (barCovers++ === 0) widgetWin?.setContentProtection(true);
  },
  show() {
    if (--barCovers === 0) widgetWin?.setContentProtection(hideBar);
  },
  // Whether another shot has the bar hidden from captures right now.
  active: () => barCovers > 0,
};

const recorder = createRecorder({
  capture,
  inspector,
  settings,
  isOwnWindow,
  isOwnElement,
  // Bounds only when the bar can show up in our own screenshots, so the
  // recorder keeps it out of them.
  widgetBounds: () => (widgetWin && widgetWin.isVisible() && !barHiddenFromCaptures() ? widgetWin.getBounds() : null),
  barCover: process.platform === 'linux' ? null : barCover,
  log,
});

// Other apps' open windows, front to back, in DIP screen coordinates.
async function otherWindows() {
  const own = new Set(app.getAppMetrics().map((m) => m.pid));
  const list = (await inspector.windows()).filter((w) => !own.has(w.pid) && w.rect?.w > 0);
  return { own, list };
}
const areaPicker = createAreaPicker({
  dir: here,
  listWindows: async () =>
    (await otherWindows()).list
      .filter((w) => !w.minimized)
      .map((w) => {
        const r = { x: w.rect.x, y: w.rect.y, width: w.rect.w, height: w.rect.h };
        return { ...(process.platform === 'win32' ? screen.screenToDipRect(null, r) : r), title: w.title };
      }),
  log,
});
const areaFrame = createAreaFrame();

// Settings > Capture > "Hide the recorder bar from screen recordings". Content
// protection keeps the bar (and the area border) out of every capture: ours,
// screen recorders and meeting apps. It only works on Windows and macOS.
let hideBar = true;
const barHiddenFromCaptures = () => hideBar && process.platform !== 'linux';
function applyBarProtection(hide = hideBar) {
  hideBar = hide !== false;
  widgetWin?.setContentProtection(hideBar || barCovers > 0);
  areaFrame.setProtected(hideBar);
}

// Apps for the "Specific apps" picker, with icons. `keep` lists chosen apps
// that should stay listed even if they're closed right now.
const iconCache = new Map();
async function listApps(keep = []) {
  const { own, list } = await otherWindows();
  const apps = groupApps(list, { ownPids: own, keep });
  await Promise.all(
    apps.map(async (a) => {
      if (!a.path) return;
      if (!iconCache.has(a.path)) {
        iconCache.set(a.path, await app.getFileIcon(a.path, { size: 'normal' }).then((img) => (img.isEmpty() ? '' : img.toDataURL()), () => ''));
      }
      a.icon = iconCache.get(a.path);
    }),
  );
  return apps.map(({ path, ...a }) => a);
}

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
  // Keeps the recorder bar out of screenshots (Windows 10 2004+ and macOS)
  // unless the user turned that off.
  widgetWin.setContentProtection(hideBar);
  widgetWin.loadFile(join(here, 'widget.html'));
}

// Bottom centre of the primary display. In area mode the bar must not cover
// the area, so it moves just below it (or above it) when they would overlap.
function placeWidget() {
  const [w, h] = widgetWin.getSize();
  const s = recorder.state;
  const area = s.active && s.scope?.mode === 'area' ? s.scope.area : null;
  const work = (area ? screen.getDisplayMatching(area) : screen.getPrimaryDisplay()).workArea;
  let x = Math.round(work.x + (work.width - w) / 2);
  let y = Math.round(work.y + work.height - h - 12);
  const gap = 10;
  const overlaps = (yy) => area && x < area.x + area.width + gap && x + w > area.x - gap && yy < area.y + area.height + gap && yy + h > area.y - gap;
  if (overlaps(y)) {
    const below = area.y + area.height + gap;
    const above = area.y - gap - h;
    if (below + h <= work.y + work.height) y = below;
    else if (above >= work.y) y = above;
    else x = area.x + area.width + gap + w <= work.x + work.width ? area.x + area.width + gap : Math.max(work.x, area.x - gap - w);
  }
  widgetWin.setPosition(Math.round(x), Math.round(y));
}

function broadcast(channel, payload) {
  for (const w of [mainWin, widgetWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

// ---------- recording ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// `opts.scope` limits the capture (scope.js). An area capture first shows the
// area picker, preselecting `scope.area` if given.
async function startRecording(opts = {}) {
  if (recorder.state.active || areaPicker.open) return recorder.state;
  const { capture: cap } = await settings.get();
  const scope = opts.scope || { mode: 'screen' };
  const hide = mainWin && !process.env.FLOWDOC_SELFTEST;
  // The area is chosen over the app being recorded, so FlowDoc steps aside for it.
  if (hide && (cap.hideWindow || scope.mode === 'area')) mainWin.minimize();
  if (scope.mode === 'area') {
    if (hide) await sleep(250); // let the minimise animation finish
    const area = await areaPicker.pick({ initial: scope.area });
    if (!area) {
      if (hide) mainWin.restore();
      return { ...recorder.state, cancelled: true };
    }
    opts = { ...opts, scope: { ...scope, area } };
  }
  let state;
  try {
    state = await recorder.start(opts);
  } catch (err) {
    if (hide) mainWin.restore();
    throw err;
  }
  placeWidget();
  widgetWin.showInactive();
  widgetWin.moveTop();
  // Offered again next time. Only the parts this capture used are replaced.
  settings.update({ capture: { lastScope: state.scope } }).catch(() => {});
  return state;
}

// Area mode: pick a new area while capturing. The capture pauses meanwhile.
async function reselectArea() {
  const s = recorder.state;
  if (!s.active || s.scope?.mode !== 'area' || areaPicker.open) return s;
  recorder.setPaused(true);
  widgetWin?.hide();
  areaFrame.hide();
  const area = await areaPicker.pick({ initial: s.scope.area });
  if (area) await recorder.setArea(area);
  if (!s.paused) recorder.setPaused(false);
  if (recorder.state.active) {
    placeWidget();
    widgetWin?.showInactive();
    widgetWin?.moveTop();
  }
  return recorder.state;
}

recorder.events.on('state', (state) => {
  broadcast('recorder:state', state);
  updateTray(state);
  if (state.active && state.scope?.mode === 'area' && !areaPicker.open) {
    areaFrame.show(state.scope.area, { paused: state.paused });
    // The border shares the bar's "always on top" level; keep the bar in front.
    if (widgetWin?.isVisible()) widgetWin.moveTop();
  } else areaFrame.hide();
});

recorder.events.on('stray', (app) => widgetWin?.webContents.send('recorder:stray', app));

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
  ipcMain.handle('recorder:apps', (_e, keep) => listApps(Array.isArray(keep) ? keep : []));
  ipcMain.handle('recorder:setApps', (_e, apps) => recorder.setApps(apps));
  ipcMain.handle('recorder:includeApp', (_e, a) => recorder.includeApp(a));
  ipcMain.handle('recorder:dismissStray', (_e, key) => recorder.dismissStray(key));
  ipcMain.handle('recorder:reselectArea', () => reselectArea());
  // The recorder bar grows for its app list and prompts; keep its bottom centre in place.
  ipcMain.on('recorder:fit', (_e, size) => {
    if (!widgetWin || widgetWin.isDestroyed()) return;
    const b = widgetWin.getBounds();
    const width = Math.max(240, Math.min(900, Math.ceil(size?.width || 0)));
    const height = Math.max(48, Math.min(700, Math.ceil(size?.height || 0)));
    if (width === b.width && height === b.height) return;
    widgetWin.setBounds({ x: Math.round(b.x + (b.width - width) / 2), y: b.y + b.height - height, width, height });
  });

  ipcMain.handle('settings:get', () => settings.getPublic());
  ipcMain.handle('settings:update', async (_e, patch) => {
    const next = await settings.update(patch);
    if (patch?.capture && 'hideBar' in patch.capture) applyBarProtection((await settings.get()).capture.hideBar);
    return next;
  });
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
  ipcMain.handle('notion:setSaved', async (_e, list) => settings.update({ notion: { saved: normalizeSaved(list) } }));
  ipcMain.handle('notion:save', async (e, req) => {
    const token = await settings.getKey('notion');
    const result = await saveToNotion(token, req, (p) => !e.sender.isDestroyed() && e.sender.send('notion:progress', p));
    // Remember the destination under Recent.
    if (req.location?.id) await settings.update({ notion: { recents: withRecent((await settings.get()).notion.recents, req.location) } });
    return result;
  });
  ipcMain.on('theme:set', (_e, mode) => {
    const source = mode === 'light' || mode === 'dark' ? mode : 'system';
    if (nativeTheme.themeSource !== source) nativeTheme.themeSource = source;
    mainWin?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#0b1120' : '#f6f7fb');
    settings.update({ ui: { theme: source } }).catch(() => {});
  });
  // ---------- guides folder ----------
  const storageInfo = async () => ({
    dir: store.dir,
    defaultDir: DEFAULT_LIBRARY,
    isDefault: store.dir === DEFAULT_LIBRARY,
    guides: ((await store.get('guides_index')) || []).length,
    fallback: storageFallback,
  });
  const switchLibrary = async (target, { copy = true } = {}) => {
    if (recorder.state.active) throw new Error('Finish the capture first, then change the guides folder.');
    if (!(await ensureWritable(target))) throw new Error("FlowDoc can't write to that folder. Choose one you have permission to change.");
    const copied = copy ? await mergeLibrary(store.dir, target) : 0;
    await store.setDir(target);
    await settings.update({ storage: { libraryDir: target === DEFAULT_LIBRARY ? '' : target } });
    storageFallback = null;
    return { ...(await storageInfo()), copied };
  };
  ipcMain.handle('storage:get', storageInfo);
  ipcMain.handle('storage:inspect', (_e, folder) => inspectFolder(String(folder || '')));
  ipcMain.handle('storage:choose', async () => {
    const res = await dialog.showOpenDialog(mainWin, {
      title: 'Choose a folder for your FlowDoc guides',
      defaultPath: store.dir,
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    return res.canceled || !res.filePaths[0] ? null : inspectFolder(res.filePaths[0]);
  });
  ipcMain.handle('storage:apply', (_e, { target, copy }) => switchLibrary(target, { copy }));
  ipcMain.handle('storage:reset', (_e, { copy } = {}) => switchLibrary(DEFAULT_LIBRARY, { copy }));
  ipcMain.handle('storage:open', () => shell.openPath(store.dir));

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
  // Use the guides folder chosen in Settings, if it's reachable.
  const libraryDir = (await settings.get()).storage?.libraryDir;
  if (libraryDir && libraryDir !== DEFAULT_LIBRARY) {
    if (await folderUsable(libraryDir)) await store.setDir(libraryDir);
    else {
      storageFallback = { wanted: libraryDir };
      log(`guides folder ${libraryDir} is not available; using ${DEFAULT_LIBRARY}`);
    }
  }
  // Apply the saved theme before the first window paints.
  nativeTheme.themeSource = (await settings.get()).ui?.theme || 'system';
  hideBar = (await settings.get()).capture?.hideBar !== false;
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
    runSelfTest({ app, mainWin, recorder, startRecording, settings, listApps, areaPicker, areaFrame, applyBarProtection, markCapturable: (w) => capturableWindows.add(w), getWidget: () => widgetWin }).catch((err) => {
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
