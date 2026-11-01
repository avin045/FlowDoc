const $ = (id) => document.getElementById(id);
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>';
let state = { active: false, paused: false, stepCount: 0, startedAt: Date.now() };

function render() {
  $('bar').classList.toggle('paused', state.paused);
  $('label').textContent = state.paused ? 'Paused' : 'Capturing';
  const secs = state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0;
  const time = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  $('meta').textContent = `${state.stepCount || 0} step${state.stepCount === 1 ? '' : 's'} · ${time}`;
  $('toggle').innerHTML = state.paused ? `${PLAY}Resume` : PAUSE;
  $('toggle').title = state.paused ? 'Resume capture' : 'Pause capture';
}

// Runs a recorder action once; buttons stay disabled until it settles so a
// double click can't fire it twice.
async function act(button, fn) {
  if (button.disabled) return;
  button.disabled = true;
  try {
    const s = await fn();
    if (s && typeof s.active === 'boolean') update(s);
  } finally {
    button.disabled = false;
  }
}

$('toggle').addEventListener('click', (e) => act(e.currentTarget, () => (state.paused ? recorderBar.resume() : recorderBar.pause())));
$('done').addEventListener('click', (e) => act(e.currentTarget, () => recorderBar.stop()));

// The bar never takes focus, so a confirm() dialog can't be relied on.
// First click arms Discard; a second click within 3 s confirms.
let discardTimer = 0;
$('discard').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (!btn.classList.contains('confirm')) {
    btn.classList.add('confirm');
    $('discardLabel').hidden = false;
    btn.title = 'Click again to delete this recording';
    discardTimer = setTimeout(disarm, 3000);
    return;
  }
  disarm();
  act(btn, () => recorderBar.discard());
});
function disarm() {
  clearTimeout(discardTimer);
  $('discard').classList.remove('confirm');
  $('discardLabel').hidden = true;
  $('discard').title = 'Discard this recording';
}

// ---------- scope: area / apps ----------

const AREA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/></svg>';
const APPS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>';
const SCREEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
let scopeKey = '';
let appList = [];

function renderScope() {
  const sc = state.scope || { mode: 'screen' };
  const key = JSON.stringify([state.active, sc]);
  if (key === scopeKey) return;
  scopeKey = key;
  const btn = $('scope');
  btn.hidden = !state.active || !['area', 'apps'].includes(sc.mode);
  if (sc.mode === 'area') {
    btn.innerHTML = `${AREA}Area`;
    btn.title = 'Choose a different area';
  } else if (sc.mode === 'apps') {
    const n = sc.apps?.length || 0;
    btn.innerHTML = APPS;
    btn.append(n === 1 ? sc.apps[0].name : `${n} apps`);
    btn.title = 'Choose which apps are captured';
  }
  if (sc.mode !== 'apps') $('panel').hidden = true;
  else if (!$('panel').hidden) renderPanel();
}

function renderPanel() {
  const chosen = new Set((state.scope?.apps || []).map((a) => a.key));
  const list = $('appList');
  list.textContent = '';
  for (const a of appList) {
    const row = document.createElement('label');
    row.className = 'app';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = chosen.has(a.key);
    box.addEventListener('change', () => toggleApp(a, box));
    let icon;
    if (a.shell) {
      icon = document.createElement('span');
      icon.className = 'avatar';
      icon.innerHTML = SCREEN;
    } else if (a.icon) {
      icon = document.createElement('img');
      icon.src = a.icon;
      icon.alt = '';
    } else {
      icon = document.createElement('span');
      icon.className = 'avatar';
      icon.textContent = (a.name || '?').slice(0, 1).toUpperCase();
    }
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = a.name;
    if (a.closed) {
      const note = document.createElement('small');
      note.textContent = ' · not open';
      name.append(note);
    }
    row.append(box, icon, name);
    list.append(row);
  }
}

async function toggleApp(a, box) {
  const current = state.scope?.apps || [];
  const next = box.checked ? [...current, { key: a.key, name: a.name }] : current.filter((x) => x.key !== a.key);
  $('panelError').hidden = true;
  try {
    const s = await recorderBar.setApps(next);
    if (s && typeof s.active === 'boolean') state = s;
  } catch (err) {
    box.checked = !box.checked;
    $('panelError').textContent = String(err.message || err).replace(/^.*Error: /, '');
    $('panelError').hidden = false;
  }
  renderScope();
}

async function openPanel() {
  appList = await recorderBar.apps(state.scope?.apps || []);
  $('panelError').hidden = true;
  $('panel').hidden = false;
  renderPanel();
}

$('scope').addEventListener('click', (e) => {
  const mode = state.scope?.mode;
  if (mode === 'area') return act(e.currentTarget, () => recorderBar.reselectArea());
  if (mode !== 'apps') return;
  if (!$('panel').hidden) $('panel').hidden = true;
  else act(e.currentTarget, openPanel);
});
$('panelClose').addEventListener('click', () => ($('panel').hidden = true));

// A click in an app that isn't chosen: offer to add it (the click is kept).
let strayApp = null;
let strayTimer = 0;
function hideNotice() {
  clearTimeout(strayTimer);
  strayApp = null;
  $('notice').hidden = true;
}
recorderBar.onStray((app) => {
  strayApp = app;
  $('noticeText').textContent = `${app.name} isn't being captured`;
  $('notice').hidden = false;
  clearTimeout(strayTimer);
  strayTimer = setTimeout(hideNotice, 8000);
});
$('noticeAdd').addEventListener('click', (e) => {
  const app = strayApp;
  hideNotice();
  if (app) act(e.currentTarget, () => recorderBar.includeApp(app));
});
$('noticeDismiss').addEventListener('click', () => {
  if (strayApp) recorderBar.dismissStray(strayApp.key);
  hideNotice();
});

// The window follows the size of what it shows.
new ResizeObserver(() => {
  const r = $('wrap').getBoundingClientRect();
  recorderBar.fit({ width: r.width, height: r.height });
}).observe($('wrap'));

function update(s) {
  state = s;
  if (!s.active) {
    $('panel').hidden = true;
    hideNotice();
  }
  render();
  renderScope();
}
recorderBar.onState(update);
recorderBar.state().then(update);
setInterval(render, 1000);
