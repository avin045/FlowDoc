import { listGuides } from './shared/guides.js';

const $ = (s) => document.querySelector(s);
const send = (message) => chrome.runtime.sendMessage(message);
const appUrl = (hash = '') => chrome.runtime.getURL(`app.html${hash}`);

function openApp(hash) {
  chrome.tabs.create({ url: appUrl(hash) });
  window.close();
}

function render(state) {
  $('#idle').hidden = state.active;
  $('#active').hidden = !state.active;
  if (state.active) {
    $('#statusText').textContent = state.paused ? 'Paused' : 'Capturing…';
    $('.status .rec').classList.toggle('pulse', !state.paused);
    $('#count').textContent = `${state.stepCount || 0} step${state.stepCount === 1 ? '' : 's'}`;
    $('#pause').textContent = state.paused ? 'Resume' : 'Pause';
  }
}

async function renderRecent() {
  const list = $('#recent');
  const guides = (await listGuides()).filter((g) => !g.recording).slice(0, 5);
  list.replaceChildren();
  if (!guides.length) {
    list.innerHTML = '<li class="empty">No guides yet.</li>';
    return;
  }
  for (const g of guides) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = g.title || 'Untitled guide';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `${g.stepCount} steps`;
    btn.append(title, meta);
    btn.addEventListener('click', () => openApp(`#/guide/${g.id}`));
    li.append(btn);
    list.append(li);
  }
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const capturable = /^(https?|file):/.test(tab?.url || '') && !/^https:\/\/chrome(webstore)?\.google\.com\/webstore/.test(tab?.url || '');
$('#start').disabled = !capturable;
$('#restricted').hidden = capturable;

$('#start').addEventListener('click', async () => {
  $('#start').disabled = true;
  await send({ type: 'start', tabId: tab.id });
  window.close();
});
$('#stop').addEventListener('click', async () => {
  await send({ type: 'stop' });
  window.close();
});
$('#pause').addEventListener('click', async () => {
  const state = await send({ type: 'getState' });
  render(await send({ type: state.paused ? 'resume' : 'pause' }));
});
$('#discard').addEventListener('click', async () => {
  if (!confirm('Discard this recording? The captured steps will be deleted.')) return;
  render(await send({ type: 'discard' }));
  renderRecent();
});
$('#openWorkspace').addEventListener('click', () => openApp());

render(await send({ type: 'getState' }));
renderRecent();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.recordingState) render(changes.recordingState.newValue);
});
