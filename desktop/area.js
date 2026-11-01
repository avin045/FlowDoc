// Choosing the area to capture, and marking it while capturing.
// The picker covers every display with a dimmed overlay (area.html): drag a
// rectangle, or click a window to take its frame, then press Enter or Start.
// While capturing, a thin border sits just outside the area (four thin
// windows), so the area itself isn't covered at all and the border stays out
// of its screenshots.
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
// Windows won't make a window thinner than ~30-40 px, so each side is a
// transparent window this thick that reaches away from the area, with only
// the EDGE pixels next to the area painted.
const THICK = 48;

// Four windows, one per side, all outside the area. (One window cut to a
// frame with setShape isn't reliable: on Windows the shape can be lost and the
// whole window then covers the area as a blank rectangle.)
export function createAreaFrame() {
  let strips = [];
  let shown = '';
  let hidden = true; // kept out of screen captures (follows the recorder bar setting)

  function make() {
    const w = new BrowserWindow({
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, javascript: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setIgnoreMouseEvents(true);
    w.setContentProtection(hidden);
    return w;
  }

  // Each side: the window (DIP screen coordinates) and the painted line inside
  // it. With display scaling Windows can round a window's size up by a pixel,
  // so the top and left sides stop one pixel short of the area.
  const T = THICK - 1;
  const sides = ({ x, y, width: w, height: h }) => [
    { win: { x: x - EDGE, y: y - THICK, width: w + 2 * EDGE, height: T }, line: { left: 0, top: T - EDGE, width: w + 2 * EDGE, height: EDGE } },
    { win: { x: x - EDGE, y: y + h, width: w + 2 * EDGE, height: THICK }, line: { left: 0, top: 0, width: w + 2 * EDGE, height: EDGE } },
    { win: { x: x - THICK, y, width: T, height: Math.max(h, THICK) }, line: { left: T - EDGE, top: 0, width: EDGE, height: h } },
    { win: { x: x + w, y, width: THICK, height: Math.max(h, THICK) }, line: { left: 0, top: 0, width: EDGE, height: h } },
  ];
  const page = (line, color) => {
    const css = Object.entries(line).map(([k, v]) => `${k}:${Math.round(v)}px`).join(';');
    return `data:text/html,${encodeURIComponent(`<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}i{position:fixed;background:${color};${css}}</style><i></i>`)}`;
  };

  function show(area, { paused = false } = {}) {
    if (!area) return hide();
    const key = JSON.stringify([area.x, area.y, area.width, area.height, paused]);
    if (key === shown) return;
    shown = key;
    if (strips.length !== 4 || strips.some((w) => w.isDestroyed())) {
      for (const w of strips) if (!w.isDestroyed()) w.destroy();
      strips = [make(), make(), make(), make()];
    }
    sides(area).forEach(({ win, line }, i) => {
      const w = strips[i];
      const bounds = { x: Math.round(win.x), y: Math.round(win.y), width: Math.round(win.width), height: Math.round(win.height) };
      w.loadURL(page(line, paused ? PAUSED : COLOR));
      w.setBounds(bounds);
      w.showInactive();
      w.setBounds(bounds); // Windows can resize a window by its display's scale when it first shows
    });
  }

  function hide() {
    shown = '';
    for (const w of strips) if (!w.isDestroyed()) w.hide();
  }

  const live = () => strips.filter((w) => !w.isDestroyed());
  return {
    show,
    hide,
    setProtected(on) {
      hidden = !!on;
      for (const w of live()) w.setContentProtection(hidden);
    },
    // The real window bounds (DIP), for the self-test.
    pieces: () => (shown ? live().map((w) => w.getBounds()) : []),
    windows: live,
    get visible() {
      return live().some((w) => w.isVisible());
    },
  };
}
