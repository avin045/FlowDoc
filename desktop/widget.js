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
    if (s && typeof s.active === 'boolean') {
      state = s;
      render();
    }
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

recorderBar.onState((s) => {
  state = s;
  render();
});
recorderBar.state().then((s) => {
  state = s;
  render();
});
setInterval(render, 1000);
