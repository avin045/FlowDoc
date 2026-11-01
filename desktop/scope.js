// What a capture records: the whole screen, one area of it, or only some apps.
//   { mode: 'screen' }
//   { mode: 'area', area: { x, y, width, height, displayId } }   DIP screen coordinates
//   { mode: 'apps', apps: [{ key, name }] }
// Apps are matched by a key taken from the element the inspector describes:
// the executable that shows its top-level window. The taskbar, Start menu and
// desktop share one key, SHELL, so they can be switched on as one "app".

export const SHELL = 'shell';
export const SHELL_NAME = process.platform === 'win32' ? 'Taskbar & Start menu' : 'Desktop panels';

const SHELL_EXES = new Set([
  'startmenuexperiencehost', 'searchhost', 'searchapp', 'shellexperiencehost', 'shellhost',
  'gnome-shell', 'plasmashell', 'xfce4-panel', 'cinnamon', 'mate-panel', 'budgie-panel', 'lxpanel', 'lxqt-panel',
]);
// explorer.exe is both File Explorer and the shell; the window class tells them apart.
const SHELL_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'Progman', 'WorkerW', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland']);
// File choosers that some Linux apps open through a separate portal process.
const PORTAL = /^xdg-desktop-portal/;

const norm = (exe) => String(exe || '').trim().toLowerCase().replace(/\.exe$/, '');

export function appKey(el) {
  if (!el) return '';
  const exe = norm(el.topExe || el.exe || el.app);
  if (SHELL_EXES.has(exe) || (exe === 'explorer' && SHELL_CLASSES.has(el.topClass || el.cls))) return SHELL;
  return exe;
}

export function appName(el) {
  if (appKey(el) === SHELL) return SHELL_NAME;
  const exe = norm(el?.topExe || el?.exe);
  if (exe === 'explorer') return 'File Explorer';
  return String((el?.topExe ? el.topApp : el?.app) || el?.app || exe || '').trim();
}

// Whether an element belongs to one of the chosen apps. A window owned by a
// chosen app (a file dialog, a menu) counts as that app.
export function appAllowed(scope, el) {
  if (scope?.mode !== 'apps') return true;
  const keys = new Set((scope.apps || []).map((a) => a.key));
  const key = appKey(el);
  if (!key) return false;
  if (keys.has(key)) return true;
  if (el.ownerExe && keys.has(norm(el.ownerExe))) return true;
  return PORTAL.test(key) && keys.size > 0;
}

export function pointInArea(area, p) {
  return !!area && p.x >= area.x && p.x < area.x + area.width && p.y >= area.y && p.y < area.y + area.height;
}

// A DIP rectangle as the screenshot crop of the display it is on (fractions
// 0-1), or null when it is (nearly) the whole display.
export function cropOf(rect, display) {
  const db = display.bounds;
  const x1 = Math.max(rect.x, db.x);
  const y1 = Math.max(rect.y, db.y);
  const x2 = Math.min(rect.x + rect.width, db.x + db.width);
  const y2 = Math.min(rect.y + rect.height, db.y + db.height);
  if (x2 - x1 < 8 || y2 - y1 < 8) return null;
  const crop = { x: (x1 - db.x) / db.width, y: (y1 - db.y) / db.height, w: (x2 - x1) / db.width, h: (y2 - y1) / db.height };
  return crop.w > 0.97 && crop.h > 0.97 ? null : crop;
}

// The scope as stored on a guide and in the settings (no icons, no stray data).
export function cleanScope(scope) {
  const mode = ['area', 'apps'].includes(scope?.mode) ? scope.mode : 'screen';
  const out = { mode };
  if (mode === 'area' && scope.area) {
    const { x, y, width, height, displayId } = scope.area;
    out.area = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), displayId };
  }
  if (mode === 'apps') {
    const seen = new Set();
    out.apps = (scope.apps || [])
      .filter((a) => a?.key && !seen.has(a.key) && seen.add(a.key))
      .map((a) => ({ key: String(a.key), name: String(a.name || a.key).slice(0, 80) }));
  }
  return out;
}

// Open apps, one entry per app, from the inspector's window list. `ownPids`
// are FlowDoc's own processes; `keep` adds chosen apps that aren't open now.
export function groupApps(windows, { ownPids = new Set(), keep = [] } = {}) {
  const apps = new Map();
  for (const w of windows) {
    if (ownPids.has(w.pid)) continue;
    const key = appKey(w);
    if (!key || key === SHELL || PORTAL.test(key)) continue;
    const entry = apps.get(key) || { key, name: appName(w), path: w.path || '', windows: [] };
    entry.windows.push(w.title);
    apps.set(key, entry);
  }
  for (const a of keep) if (a?.key && a.key !== SHELL && !apps.has(a.key)) apps.set(a.key, { key: a.key, name: a.name || a.key, path: '', windows: [], closed: true });
  const list = [...apps.values()].sort((a, b) => a.name.localeCompare(b.name));
  list.push({ key: SHELL, name: SHELL_NAME, path: '', windows: [], shell: true });
  return list;
}
