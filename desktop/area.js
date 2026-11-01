// Choosing the area to capture, and marking it while capturing.
// The picker covers every display with a dimmed overlay (area.html): drag a
// rectangle, or click a window to take its frame, then press Enter or Start.
// While capturing, a thin border sits just outside the area: one window around
// it, cut down to the border (setShape), so the area itself isn't covered at
// all and the border stays out of its screenshots.
import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';

export function createAreaPicker({ dir, listWindows = async () => [], log = () => {} }) {
  let session = null; // { wins, resolve }

  const finish = (area) => {
    if (!session) return;
    const { wins, resolve } = session;
    session = null;
    for (const w of wins) if (!w.isDestroyed()) w.destroy();
    resolve(area);
  };
  const owner = (e) => session?.wins.find((w) => !w.isDestroyed() && w.webContents === e.sender);

  ipcMain.on('area:done', (e, rect) => {
    const w = owner(e);
    const d = w && screen.getAllDisplays().find((x) => x.id === w.displayId);
    if (!d || !(rect?.width >= 8 && rect?.height >= 8)) return;
    finish({ x: d.bounds.x + rect.x, y: d.bounds.y + rect.y, width: rect.width, height: rect.height, displayId: d.id });
  });
  ipcMain.on('area:cancel', (e) => owner(e) && finish(null));
  // Starting a new rectangle on one display clears the others.
  ipcMain.on('area:began', (e) => {
    const from = owner(e);
    for (const w of session?.wins || []) if (w !== from && !w.isDestroyed()) w.webContents.send('area:clear');
  });

  // Resolves to { x, y, width, height, displayId } in DIP screen coordinates,
  // or null if the user cancels. `initial` preselects an earlier area.
  async function pick({ initial } = {}) {
    if (session) return null;
    let windows = [];
    try {
      windows = await listWindows();
    } catch (err) {
      log(`area picker: no window list (${err.message})`);
    }
    const displays = screen.getAllDisplays();
    const cursor = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return new Promise((resolve) => {
      const wins = displays.map((d) => {
        const b = d.bounds;
        const w = new BrowserWindow({
          ...b,
          frame: false,
          transparent: true,
          resizable: false,
          movable: false,
          minimizable: false,
          maximizable: false,
          fullscreenable: false,
          skipTaskbar: true,
          hasShadow: false,
          enableLargerThanScreen: true,
          show: false,
          webPreferences: { preload: join(dir, 'area-preload.cjs'), contextIsolation: true, sandbox: true },
        });
        w.displayId = d.id;
        w.setAlwaysOnTop(true, 'screen-saver');
        // Windows sizes a new window by the primary display's scale; set it again on its own display.
        w.setBounds(b);
        const local = (r) => ({ x: r.x - b.x, y: r.y - b.y, width: r.width, height: r.height });
        const onThis = (r) => r.x < b.x + b.width && r.x + r.width > b.x && r.y < b.y + b.height && r.y + r.height > b.y;
        w.webContents.once('did-finish-load', () => {
          w.webContents.send('area:init', {
            width: b.width,
            height: b.height,
            windows: windows.filter(onThis).map((r) => ({ ...local(r), title: r.title })),
            initial: initial && initial.displayId === d.id ? local(initial) : null,
            active: d.id === cursor.id,
          });
          w.show();
          w.setBounds(b);
          if (d.id === cursor.id) w.focus();
        });
        w.on('closed', () => session?.wins.includes(w) && finish(null));
        w.loadFile(join(dir, 'area.html'));
        return w;
      });
      session = { wins, resolve };
    });
  }

  return { pick, get open() { return !!session; }, get windows() { return session?.wins || []; } };
}

const EDGE = 3;
const COLOR = '#6366f1';
const PAUSED = '#94a3b8';

export function createAreaFrame() {
  let win = null;
  let shown = '';

  function make() {
    win = new BrowserWindow({
      frame: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false,
      backgroundColor: COLOR,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(true);
  }

  function show(area, { paused = false } = {}) {
    if (!area) return hide();
    const key = JSON.stringify([area.x, area.y, area.width, area.height, paused]);
    if (key === shown) return;
    shown = key;
    if (!win || win.isDestroyed()) make();
    const { x, y, width: w, height: h } = area;
    const W = w + 2 * EDGE;
    const H = h + 2 * EDGE;
    const bounds = { x: x - EDGE, y: y - EDGE, width: W, height: H };
    win.setBackgroundColor(paused ? PAUSED : COLOR);
    win.setBounds(bounds);
    win.setShape([
      { x: 0, y: 0, width: W, height: EDGE },
      { x: 0, y: H - EDGE, width: W, height: EDGE },
      { x: 0, y: EDGE, width: EDGE, height: h },
      { x: W - EDGE, y: EDGE, width: EDGE, height: h },
    ]);
    win.showInactive();
    win.setBounds(bounds);
  }

  function hide() {
    shown = '';
    if (win && !win.isDestroyed()) win.hide();
  }

  // The border's pieces in DIP screen coordinates (for the self-test).
  function pieces() {
    if (!win || win.isDestroyed() || !shown) return [];
    const b = win.getBounds();
    return [
      { x: b.x, y: b.y, width: b.width, height: EDGE },
      { x: b.x, y: b.y + b.height - EDGE, width: b.width, height: EDGE },
      { x: b.x, y: b.y + EDGE, width: EDGE, height: b.height - 2 * EDGE },
      { x: b.x + b.width - EDGE, y: b.y + EDGE, width: EDGE, height: b.height - 2 * EDGE },
    ];
  }

  return { show, hide, pieces, get visible() { return !!win && !win.isDestroyed() && win.isVisible(); }, get bounds() { return win?.getBounds(); } };
}
