// FlowDoc workspace: guide library + step editor + export.
import {
  createGuide,
  deleteGuide,
  getGuide,
  isDesktop,
  isExtension,
  listGuides,
  newId,
  saveGuide,
} from '../shared/guides.js';
import { cancelJob, clearJob, estimateRemaining, getJob, isRunning, onJobChange } from './aiJobs.js';
import { aiEnabled, openImproveDialog, openSettingsDialog } from './desktop.js';
import { exportGuide, FORMATS, guideToPlainText, parseImport, printGuide } from './exporters/index.js';
import { openImageEditor } from './imageEditor.js';
import { download, escapeHtml, formatDate, htmlToRich, isNumbered, renderStepCanvas, renderStepImage, richToHtml } from './render.js';
import { openNotionDialog } from './notion.js';
import { makeSampleGuide } from './sample.js';

const view = document.getElementById('view');
const $ = (sel, root = document) => root.querySelector(sel);

const I = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  grip: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.7 9.7 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-3 4.2M6.1 6.1C3.9 7.6 2.5 9.8 2 12c1 2.5 5 7 10 7 1.6 0 3-.4 4.3-1"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>',
  note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v12l-4 4H5z"/><path d="M9 9h6M9 13h4"/></svg>',
  tip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/></svg>',
  heading: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 4v16M18 4v16M6 12h12"/></svg>',
  text: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  step: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  print: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V3h12v6M6 18H4v-7h16v7h-2M8 14h8v7H8z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  dup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20V9M7 14l5-5 5 5M5 4h14"/></svg>',
  docs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="40" height="40"><path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h4"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8zM19 14l.9 2.6 2.6.9-2.6.9L19 21l-.9-2.6-2.6-.9 2.6-.9z"/></svg>',
  app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/></svg>',
  notion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h11l3 3v13H5z"/><path d="M9 16V9l6 7V9"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

const desktop = globalThis.flowdocDesktop;

// ---------- small UI helpers ----------

let toastTimer;
function toast(message, { error = false } = {}) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), error ? 5000 : 2600);
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

let openMenuEl = null;
function closeMenu() {
  openMenuEl?.remove();
  openMenuEl = null;
}
function openMenu(anchor, items) {
  closeMenu();
  const menu = h('<div class="menu" role="menu"></div>');
  for (const item of items) {
    if (item === '-') {
      menu.append(document.createElement('hr'));
      continue;
    }
    const b = h(`<button role="menuitem" class="${item.danger ? 'danger' : ''}">${item.icon || ''}<span></span></button>`);
    b.querySelector('span').textContent = item.label;
    b.addEventListener('click', () => {
      closeMenu();
      item.run();
    });
    menu.append(b);
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - mw - 8);
  let top = r.bottom + window.scrollY + 6;
  if (r.bottom + mh + 12 > window.innerHeight) top = r.top + window.scrollY - mh - 6;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  openMenuEl = menu;
  menu.querySelector('button')?.focus();
}
document.addEventListener('pointerdown', (e) => {
  if (openMenuEl && !openMenuEl.contains(e.target)) closeMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});

function autoGrow(textarea) {
  const fit = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  };
  textarea.addEventListener('input', fit);
  requestAnimationFrame(fit);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function pickFile(input) {
  return new Promise((resolve) => {
    input.value = '';
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

// ---------- sidebar ----------

async function renderSidebar(activeId) {
  const guides = (await listGuides()).slice(0, 12);
  const nav = $('#recentNav');
  nav.replaceChildren(
    ...guides.map((g) => {
      const a = document.createElement('a');
      a.href = `#/guide/${g.id}`;
      a.textContent = g.recording ? `● ${g.title || 'Recording…'}` : `${isDesktop && isRunning(g.id) ? '✨ ' : ''}${g.title || 'Untitled guide'}`;
      if (isDesktop && isRunning(g.id)) a.title = 'AI is improving this guide';
      if (g.id === activeId) a.classList.add('on');
      return a;
    }),
  );
  $('[data-nav="home"]').classList.toggle('on', !activeId);
}

// ---------- routing ----------

let current = null; // guide open in the editor
let undoStack = [];
let redoStack = [];

async function route() {
  closeMenu();
  await flushSave();
  const m = location.hash.match(/^#\/guide\/([\w-]+)/);
  if (m) await renderEditor(m[1]);
  else await renderHome();
}
window.addEventListener('hashchange', route);

// ---------- home ----------

async function renderHome() {
  current = null;
  document.title = 'FlowDoc — Guides';
  renderSidebar(null);
  const guides = await listGuides();
  view.innerHTML = `
    <div class="home">
      <div class="home-head">
        <h1>All guides</h1>
        <label class="search">${I.search}<input type="search" placeholder="Search guides" aria-label="Search guides"></label>
        <button class="secondary" data-act="import">${I.upload} Import</button>
        <button class="secondary" data-act="blank">${I.plus} Blank guide</button>
      </div>
      <div class="grid"></div>
    </div>`;
  const grid = $('.grid', view);
  if (isDesktop && desktop.sessionType === 'wayland') {
    $('.home-head', view).after(
      h(`<div class="notice">You're on a Wayland session. Linux only lets apps see clicks in other windows on X11, so log in with an <b>Xorg/X11</b> session (gear icon on the login screen) for full capture.</div>`),
    );
  }
  $('[data-act="import"]', view).addEventListener('click', importGuide);
  $('[data-act="blank"]', view).addEventListener('click', async () => {
    const guide = createGuide({ title: '', steps: [{ id: newId('s'), kind: 'manual', text: '' }] });
    await saveGuide(guide);
    location.hash = `#/guide/${guide.id}`;
  });

  if (!guides.length) {
    grid.replaceWith(
      h(`<div class="empty-state">
        ${I.docs}
        <h2>Capture your first guide</h2>
        <p>${
          isDesktop
            ? 'Walk through any process on your computer: in File Explorer, a browser, Office or any other app. FlowDoc writes each step down and grabs a screenshot, then you edit and export the guide.'
            : 'Walk through any process in your browser. FlowDoc writes each step down and grabs a screenshot, then you edit and export the guide.'
        }</p>
        <div class="actions">
          <button class="primary" data-act="capture"><span class="rec"></span> New capture</button>
          <button class="secondary" data-act="sample">Open a sample guide</button>
        </div>
        <div class="steps-howto">
          <div><b>1. Capture</b>${
            isDesktop
              ? 'Click <i>New capture</i> (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> anywhere).'
              : 'Click the FlowDoc icon in your toolbar and choose <i>Start capture</i>.'
          }</div>
          <div><b>2. Do the task</b>Click, type and select as usual${isDesktop ? ' in any app' : ''}. Each action becomes a step.</div>
          <div><b>3. Edit &amp; export</b>Click <i>Done</i>, polish the text, blur private details, export to PDF, Word, HTML or Markdown.</div>
        </div>
      </div>`),
    );
    $('[data-act="capture"]', view).addEventListener('click', startCaptureDialog);
    $('[data-act="sample"]', view).addEventListener('click', openSample);
    return;
  }

  const renderCards = (query = '') => {
    const q = query.trim().toLowerCase();
    grid.replaceChildren();
    for (const g of guides.filter((x) => !q || (x.title || '').toLowerCase().includes(q))) {
      const card = h(`<a class="card" href="#/guide/${g.id}">
        <div class="thumb">${g.thumb ? '' : I.image}</div>
        <div class="card-body">
          <p class="card-title"></p>
          <div class="card-meta">${g.recording ? '<span class="badge">Recording</span>' : `${g.stepCount} steps · ${formatDate(g.updatedAt)}`}</div>
        </div>
        <button class="icon-btn card-menu" aria-label="Guide actions">${I.more}</button>
      </a>`);
      if (g.thumb) $('.thumb', card).style.backgroundImage = `url("${g.thumb}")`;
      $('.card-title', card).textContent = g.title || 'Untitled guide';
      $('.card-menu', card).addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.currentTarget, [
          { label: 'Open', icon: I.edit, run: () => (location.hash = `#/guide/${g.id}`) },
          { label: 'Duplicate', icon: I.dup, run: () => duplicateGuide(g.id) },
          '-',
          { label: 'Delete', icon: I.trash, danger: true, run: () => removeGuide(g.id, g.title) },
        ]);
      });
      grid.append(card);
    }
    if (!grid.children.length) grid.append(h('<p class="card-meta">No guides match your search.</p>'));
  };
  renderCards();
  $('.search input', view).addEventListener('input', (e) => renderCards(e.target.value));
  backfillThumbs(guides);
}

// Guides captured by the recorder have no thumbnail yet; make them in the background.
async function backfillThumbs(guides) {
  for (const g of guides) {
    if (g.thumb || g.recording) continue;
    const guide = await getGuide(g.id);
    if (!guide) continue;
    if (await updateThumb(guide)) await saveGuide(guide, { touch: false });
  }
}

async function updateThumb(guide) {
  const first = guide.steps.find((s) => isNumbered(s) && s.screenshot && !s.hideImage);
  const key = first ? `${first.id}|${first.screenshot.length}|${JSON.stringify([first.redactions, first.crop, first.highlight])}` : '';
  if (key === (guide.thumbKey || '') && (guide.thumb || !first)) return false;
  guide.thumbKey = key;
  guide.thumb = first ? (await renderStepCanvas(first, { maxWidth: 480 })).toDataURL('image/jpeg', 0.75) : null;
  return true;
}

async function openSample() {
  const guide = makeSampleGuide();
  await updateThumb(guide);
  await saveGuide(guide);
  location.hash = `#/guide/${guide.id}`;
}

async function importGuide() {
  const file = await pickFile($('#importFile'));
  if (!file) return;
  try {
    const guide = parseImport(await file.text());
    guide.id = newId('g');
    delete guide.recording;
    for (const s of guide.steps) s.id ||= newId('s');
    await updateThumb(guide);
    await saveGuide(guide);
    toast('Guide imported');
    location.hash = `#/guide/${guide.id}`;
  } catch (err) {
    toast(`Import failed: ${err.message}`, { error: true });
  }
}

async function duplicateGuide(id) {
  const guide = await getGuide(id);
  if (!guide) return;
  const copy = structuredClone(guide);
  copy.id = newId('g');
  copy.title = `${guide.title || 'Untitled guide'} (copy)`;
  copy.createdAt = Date.now();
  copy.steps.forEach((s) => (s.id = newId('s')));
  delete copy.recording;
  await saveGuide(copy);
  toast('Guide duplicated');
  if (current) location.hash = `#/guide/${copy.id}`;
  else route();
}

async function removeGuide(id, title) {
  if (!confirm(`Delete "${title || 'Untitled guide'}"? This can't be undone.`)) return;
  if (current?.id === id) {
    clearTimeout(saveTimer);
    current = null;
  }
  await deleteGuide(id);
  toast('Guide deleted');
  if (location.hash.includes(id)) location.hash = '#/';
  else route();
}

// ---------- capture launcher ----------

async function startCaptureDialog() {
  if (isDesktop) {
    const state = await desktop.recorder.state();
    if (state.active) return desktop.recorder.stop();
    await flushSave();
    await desktop.recorder.start();
    return;
  }
  if (!isExtension) {
    const dlg = h(`<dialog><div class="dlg">
      <h2>Install the recorder</h2>
      <p class="sub">Capturing runs in the FlowDoc browser extension. Load it once and every capture shows up here.</p>
      <ol style="margin:0 0 4px;padding-left:20px;line-height:1.8">
        <li>Open <code>chrome://extensions</code> (or <code>edge://extensions</code>).</li>
        <li>Turn on <b>Developer mode</b>.</li>
        <li>Click <b>Load unpacked</b> and choose the project's <code>extension</code> folder.</li>
        <li>Pin FlowDoc, open any site and click <b>Start capture</b>.</li>
      </ol>
      <div class="dlg-foot"><button class="primary" value="close">Got it</button></div>
    </div></dialog>`);
    document.body.append(dlg);
    $('button', dlg).addEventListener('click', () => dlg.close());
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
    return;
  }
  const tabs = (await chrome.tabs.query({})).filter((t) => /^(https?|file):/.test(t.url || ''));
  const dlg = h(`<dialog><div class="dlg">
    <h2>Start a capture</h2>
    <p class="sub">Pick the tab where the process starts, or open a new address. Capture begins straight away.</p>
    <form class="url-form" style="display:flex;gap:8px;margin-bottom:14px">
      <input type="url" required placeholder="https://example.com" style="flex:1;border:1px solid var(--line-2);border-radius:8px;padding:8px 10px;background:var(--panel)">
      <button class="primary">Open &amp; capture</button>
    </form>
    <div class="tab-list" style="display:flex;flex-direction:column;gap:4px;max-height:300px;overflow:auto"></div>
    <div class="dlg-foot"><button class="secondary" data-close>Cancel</button></div>
  </div></dialog>`);
  const list = $('.tab-list', dlg);
  if (!tabs.length) list.append(h('<p class="card-meta">No open web pages. Enter an address above.</p>'));
  for (const t of tabs) {
    const b = h('<button class="ghost" style="justify-content:flex-start;text-align:left;white-space:normal"><img width="16" height="16" alt=""><span></span></button>');
    $('span', b).textContent = t.title || t.url;
    if (t.favIconUrl?.startsWith('http')) $('img', b).src = t.favIconUrl;
    else $('img', b).remove();
    b.addEventListener('click', async () => {
      dlg.close();
      await chrome.tabs.update(t.id, { active: true });
      await chrome.windows.update(t.windowId, { focused: true });
      await chrome.runtime.sendMessage({ type: 'start', tabId: t.id });
    });
    list.append(b);
  }
  $('.url-form', dlg).addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = $('input', dlg).value;
    dlg.close();
    const tab = await chrome.tabs.create({ url, active: true });
    const onUpdated = async (id, info) => {
      if (id !== tab.id || info.status !== 'complete') return;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id });
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
$('#howToCapture').addEventListener('click', startCaptureDialog);

// ---------- editor: persistence & history ----------

let saveTimer = 0;
let savePromise = null;

function setSaveState(text) {
  const el = $('.save-state', view);
  if (el) el.textContent = text;
}

function scheduleSave() {
  if (!current || current.recording) return;
  setSaveState('Saving…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 450);
}

async function doSave() {
  saveTimer = 0;
  const guide = current;
  if (!guide) return;
  savePromise = (async () => {
    await updateThumb(guide);
    await saveGuide(guide);
  })();
  await savePromise;
  savePromise = null;
  if (guide === current) setSaveState('All changes saved');
  renderSidebar(guide.id);
}

async function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    await doSave();
  } else if (savePromise) await savePromise;
}
window.addEventListener('beforeunload', (e) => {
  if (saveTimer) {
    doSave();
    e.preventDefault();
  }
});

const snapshot = () => ({
  title: current.title,
  description: current.description,
  steps: current.steps.map((s) => ({ ...s, redactions: [...(s.redactions || [])] })),
});

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function restore(snap) {
  current.title = snap.title;
  current.description = snap.description;
  current.steps = snap.steps;
  $('.title-input', view).value = current.title;
  $('.desc-input', view).value = current.description;
  $('.title-input', view).dispatchEvent(new Event('input'));
  $('.desc-input', view).dispatchEvent(new Event('input'));
  renderBlocks();
  scheduleSave();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
  updateHistoryButtons();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateHistoryButtons();
}
function updateHistoryButtons() {
  const u = $('[data-act="undo"]', view);
  const r = $('[data-act="redo"]', view);
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}

function mutate(fn) {
  pushUndo();
  fn();
  renderBlocks();
  scheduleSave();
}

document.addEventListener('keydown', (e) => {
  if (!current || !(e.ctrlKey || e.metaKey)) return;
  const editing = e.target.closest?.('[contenteditable="true"], input, textarea');
  const key = e.key.toLowerCase();
  if (editing) return; // native undo inside text fields
  if (key === 'z' && !e.shiftKey) {
    e.preventDefault();
    undo();
  } else if ((key === 'z' && e.shiftKey) || key === 'y') {
    e.preventDefault();
    redo();
  }
});

// ---------- editor: view ----------

async function renderEditor(id) {
  const guide = await getGuide(id);
  if (!guide) {
    view.innerHTML = `<div class="home"><div class="empty-state"><h2>Guide not found</h2><p>It may have been deleted.</p><div class="actions"><a class="primary" href="#/">Back to all guides</a></div></div></div>`;
    renderSidebar(null);
    return;
  }
  if (current?.id !== id) {
    undoStack = [];
    redoStack = [];
  }
  current = guide;
  document.title = `${guide.title || 'Untitled guide'} — FlowDoc`;
  renderSidebar(id);
  const ro = !!guide.recording;

  let host = '';
  try {
    host = new URL(guide.source?.url || guide.steps.find((s) => s.url)?.url).hostname;
  } catch {}
  const apps = [...new Set(guide.steps.map((s) => s.app).filter(Boolean))];
  const showAi = isDesktop && !ro && (await aiEnabled());

  view.innerHTML = `
    <div class="doc-bar">
      <a class="ghost" href="#/">${I.back}<span class="label">All guides</span></a>
      <span class="save-state">${ro ? '' : 'All changes saved'}</span>
      <span class="spacer"></span>
      <button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo">${I.undo}</button>
      <button class="icon-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">${I.redo}</button>
      ${showAi ? `<button class="ghost ai-btn" data-act="ai" title="Rewrite steps and title with AI">${I.sparkle}<span class="label">Improve with AI</span></button>` : ''}
      <button class="ghost" data-act="copy" title="Copy the steps as plain text">${I.copy}<span class="label">Copy text</span></button>
      <button class="ghost" data-act="print">${I.print}<span class="label">Print</span></button>
      ${isDesktop && !ro ? `<button class="ghost" data-act="notion" title="Save this guide as a Notion page">${I.notion}<span class="label">Notion</span></button>` : ''}
      <button class="primary" data-act="export">${I.download} Export</button>
      <button class="icon-btn" data-act="more" aria-label="More actions">${I.more}</button>
    </div>
    <div class="editor-wrap">
      <article class="doc">
        ${ro ? '<div class="recording-banner"><span class="badge"></span>Capture in progress. Steps appear here live; editing unlocks when you click Done.</div>' : ''}
        <textarea class="title-input" rows="1" placeholder="Give your guide a title" aria-label="Guide title"></textarea>
        <textarea class="desc-input" rows="1" placeholder="Add a short description of what this guide covers…" aria-label="Description"></textarea>
        <div class="doc-meta">
          <span class="m-steps">${I.list}<b></b></span>
          <span>${I.clock}${formatDate(guide.createdAt)}</span>
          ${host ? `<span>${I.link}${escapeHtml(host)}</span>` : ''}
          ${!host && apps.length ? `<span title="${escapeHtml(apps.join(', '))}">${I.app}${escapeHtml(apps.slice(0, 3).join(', '))}${apps.length > 3 ? ` +${apps.length - 3}` : ''}</span>` : ''}
        </div>
        <ol class="blocks"></ol>
        <div class="add-row" ${ro ? 'hidden' : ''}>
          <button class="secondary" data-add="manual">${I.step} Step</button>
          <button class="secondary" data-add="tip">${I.tip} Tip</button>
          <button class="secondary" data-add="alert">${I.alert} Alert</button>
          <button class="secondary" data-add="heading">${I.heading} Heading</button>
          <button class="secondary" data-add="text">${I.text} Text</button>
        </div>
      </article>
      <aside class="outline"><h3>Contents</h3><ol></ol></aside>
    </div>`;

  const title = $('.title-input', view);
  const desc = $('.desc-input', view);
  title.value = guide.title || '';
  desc.value = guide.description || '';
  title.readOnly = desc.readOnly = ro;
  autoGrow(title);
  autoGrow(desc);
  for (const [el, field] of [
    [title, 'title'],
    [desc, 'description'],
  ]) {
    el.addEventListener('focus', () => pushUndo());
    el.addEventListener('input', (e) => {
      if (!e.isTrusted) return;
      current[field] = el.value;
      if (field === 'title') document.title = `${el.value || 'Untitled guide'} — FlowDoc`;
      scheduleSave();
    });
  }
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      desc.focus();
    }
  });

  $('[data-act="undo"]', view).addEventListener('click', undo);
  $('[data-act="redo"]', view).addEventListener('click', redo);
  $('[data-act="export"]', view).addEventListener('click', () => openExportDialog(current));
  $('[data-act="notion"]', view)?.addEventListener('click', async () => {
    await flushSave();
    const guide = current;
    openNotionDialog(guide, {
      toast,
      onSaved: (info) => {
        guide.notion = info;
        if (current === guide) scheduleSave();
        else saveGuide(guide);
      },
    });
  });
  $('[data-act="print"]', view).addEventListener('click', () => printGuide(current));
  $('[data-act="ai"]', view)?.addEventListener('click', () => runAiImprove());
  $('[data-act="copy"]', view).addEventListener('click', async () => {
    await navigator.clipboard.writeText(guideToPlainText(current));
    toast('Steps copied to clipboard');
  });
  $('[data-act="more"]', view).addEventListener('click', (e) =>
    openMenu(e.currentTarget, [
      ...(isDesktop && current.notion?.url ? [{ label: 'Open in Notion', icon: I.notion, run: () => desktop.openExternal(current.notion.url) }] : []),
      { label: 'Duplicate guide', icon: I.dup, run: () => duplicateGuide(current.id) },
      { label: 'Show all screenshots', icon: I.image, run: () => mutate(() => current.steps.forEach((s) => (s.hideImage = false))) },
      { label: 'Hide all screenshots', icon: I.eyeOff, run: () => mutate(() => current.steps.forEach((s) => (s.hideImage = true))) },
      '-',
      { label: 'Delete guide', icon: I.trash, danger: true, run: () => removeGuide(current.id, current.title) },
    ]),
  );
  view.querySelectorAll('[data-add]').forEach((b) =>
    b.addEventListener('click', () => insertBlock(current.steps.length, b.dataset.add)),
  );
  updateHistoryButtons();
  renderBlocks();
  if (isDesktop) updateAiBanner();
}

function runAiImprove(auto = false) {
  if (!current) return;
  openImproveDialog(current, { toast, auto });
}

// Writes an AI job's result into a guide. Steps the user edited while the job
// was running are left alone; notes the user wrote are never replaced, while
// notes from an earlier AI run are (and Crisp removes them).
function applyAiResult(guide, job) {
  const { result, original, style, stepIdByNumber } = job;
  let changed = 0;
  if (result.title) guide.title = result.title;
  if (result.description) guide.description = result.description;
  for (const s of guide.steps) {
    const r = result.steps.get(s.id);
    if (!r || s.text !== original.get(s.id)) continue;
    s.text = r.text;
    changed++;
    const userNote = s.note && !s.aiNote;
    if (style === 'crisp') {
      if (!userNote) {
        s.note = '';
        delete s.aiNote;
      }
    } else if (r.note && !userNote) {
      s.note = r.note;
      s.aiNote = true;
    }
  }
  // Conceptual: section headings, only for guides that don't have any yet.
  if (result.sections?.length && !guide.steps.some((s) => s.kind === 'heading')) {
    for (const sec of [...result.sections].reverse()) {
      const at = guide.steps.findIndex((s) => s.id === stepIdByNumber.get(sec.startStep));
      if (at >= 0) guide.steps.splice(at, 0, { id: newId('s'), kind: 'heading', text: sec.title, aiHeading: true });
    }
  }
  return changed;
}

function refreshTitleFields() {
  for (const [sel, field] of [['.title-input', 'title'], ['.desc-input', 'description']]) {
    const el = $(sel, view);
    if (!el) continue;
    el.value = current[field] || '';
    el.dispatchEvent(new Event('input')); // re-fits the textarea; untrusted, so not re-saved
  }
  document.title = `${current.title || 'Untitled guide'} — FlowDoc`;
}

function aiSummaryMessage(job, changed) {
  const chosen = job.model;
  const others = [...job.models].filter((m) => m && m !== chosen);
  const fellBack = others.length && chosen ? ` (${chosen} was busy, so ${others.join(' and ')} answered)` : '';
  const secs = Math.round((job.finishedAt - job.startedAt) / 1000);
  const parts = [`${changed} step${changed === 1 ? '' : 's'}`];
  if (job.result.title) parts.push('the title');
  if (job.result.sections?.length) parts.push(`${job.result.sections.length} section headings`);
  return `AI improved ${parts.join(', ')} of “${job.title}” in ${secs} s${fellBack}.`;
}

// Finished jobs land here whether or not their dialog is still open.
if (isDesktop) {
  onJobChange(async (job) => {
    updateAiBanner(job);
    renderSidebar(current?.id);
    if (job.status === 'running' || job.status === 'cancelled') return;
    clearJob(job.guideId);
    if (job.status === 'failed') {
      toast(`AI couldn't improve “${job.title}”: ${String(job.errors[0] || 'no answer').replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}`, { error: true });
      return;
    }
    const settings = await desktop.settings.get();
    job.model = settings.ai.models[job.provider];
    let changed;
    if (current?.id === job.guideId && !current.recording) {
      pushUndo();
      changed = applyAiResult(current, job);
      renderBlocks();
      refreshTitleFields();
      scheduleSave();
      toast(`${aiSummaryMessage(job, changed)} Ctrl+Z to undo.`);
    } else {
      const guide = await getGuide(job.guideId);
      if (!guide) return;
      changed = applyAiResult(guide, job);
      await saveGuide(guide);
      renderSidebar(current?.id);
      toast(`${aiSummaryMessage(job, changed)} Open it from the sidebar.`);
    }
    if (job.errors.length) setTimeout(() => toast(`${job.errors.length} part(s) failed: ${job.errors[0]}`, { error: true }), 2800);
    // Let the user know if they've switched to another window meanwhile.
    if (!document.hasFocus() && 'Notification' in window) {
      const n = new Notification('FlowDoc', { body: aiSummaryMessage(job, changed) });
      n.onclick = () => {
        window.focus();
        location.hash = `#/guide/${job.guideId}`;
      };
    }
  });
}

// Live progress strip at the top of the editor while a job runs on this guide.
function updateAiBanner(job = current && getJob(current.id)) {
  const doc = $('.doc', view);
  if (!doc || !current) return;
  let banner = $('.ai-banner', doc);
  if (!job || job.guideId !== current.id || job.status !== 'running') {
    banner?.remove();
    return;
  }
  if (!banner) {
    banner = h(`<div class="ai-banner" role="status">
      <span class="spark">${I.sparkle}</span>
      <div class="ai-banner-body"><b></b><div class="bar"><span></span></div></div>
      <button class="ghost" data-act="view">View</button>
      <button class="ghost danger" data-act="stop">Stop</button>
    </div>`);
    $('[data-act="view"]', banner).addEventListener('click', () => runAiImprove());
    $('[data-act="stop"]', banner).addEventListener('click', () => {
      cancelJob(current.id);
      toast('Stopped. Nothing was changed.');
    });
    doc.prepend(banner);
  }
  const left = estimateRemaining(job);
  const label = job.total
    ? `Improving with AI (${job.style}) — ${job.done} of ${job.total} steps${left != null ? ` · about ${Math.max(1, Math.round(left / 60000))} min left` : ''}`
    : `Improving with AI (${job.style}) — ${job.phase}`;
  $('b', banner).textContent = label;
  $('.bar span', banner).style.width = `${job.total ? Math.round((job.done / job.total) * 100) : 8}%`;
}

function blockNumberMap() {
  const map = new Map();
  let n = 0;
  for (const s of current.steps) if (isNumbered(s)) map.set(s.id, ++n);
  return map;
}

function renderBlocks() {
  const list = $('.blocks', view);
  if (!list || !current) return;
  const ro = !!current.recording;
  const numbers = blockNumberMap();
  list.replaceChildren();
  current.steps.forEach((step, index) => {
    step.id ||= newId('s');
    if (!ro) list.append(inserter(index));
    list.append(blockEl(step, index, numbers.get(step.id), ro));
  });
  $('.m-steps b', view).textContent = `${numbers.size} step${numbers.size === 1 ? '' : 's'}`;
  renderOutline(numbers);
}

function renderOutline(numbers) {
  const ol = $('.outline ol', view);
  if (!ol) return;
  ol.replaceChildren();
  for (const s of current.steps) {
    if (!isNumbered(s) && s.kind !== 'heading') continue;
    const a = h(`<li><a href="#" class="${s.kind === 'heading' ? 'h' : ''}"><span class="n">${numbers.get(s.id) || ''}</span><span class="t"></span></a></li>`);
    $('.t', a).textContent = (s.text || '').replace(/\*\*/g, '') || 'Untitled step';
    $('a', a).addEventListener('click', (e) => {
      e.preventDefault();
      view.querySelector(`[data-id="${s.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    ol.append(a);
  }
}

function inserter(index) {
  const el = h(`<li class="inserter" aria-hidden="false"><button class="plus" title="Insert here" aria-label="Insert a block here">${I.plus}</button><span class="line"></span></li>`);
  $('.plus', el).addEventListener('click', (e) => {
    el.classList.add('open');
    openMenu(e.currentTarget, insertItems(index));
    const observer = new MutationObserver(() => {
      if (!openMenuEl) {
        el.classList.remove('open');
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true });
  });
  return el;
}

const insertItems = (index) => [
  { label: 'Step', icon: I.step, run: () => insertBlock(index, 'manual') },
  { label: 'Tip', icon: I.tip, run: () => insertBlock(index, 'tip') },
  { label: 'Alert', icon: I.alert, run: () => insertBlock(index, 'alert') },
  { label: 'Heading', icon: I.heading, run: () => insertBlock(index, 'heading') },
  { label: 'Text', icon: I.text, run: () => insertBlock(index, 'text') },
];

function insertBlock(index, kind) {
  const step = { id: newId('s'), kind, text: '' };
  mutate(() => current.steps.splice(index, 0, step));
  const el = view.querySelector(`[data-id="${step.id}"] .b-text`);
  el?.focus();
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

const PLACEHOLDER = {
  action: 'Describe this step',
  manual: 'Describe this step, e.g. Click **Save**',
  tip: 'Add a helpful tip…',
  alert: 'Add an important warning…',
  heading: 'Section heading',
  text: 'Write some text…',
};

function blockEl(step, index, number, ro) {
  const kind = step.kind || 'action';
  const el = h(`<li class="block kind-${kind}" data-id="${step.id}">
    <div class="gutter"></div>
    <div class="b-body"></div>
  </li>`);
  const gutter = $('.gutter', el);
  const body = $('.b-body', el);

  if (number) gutter.append(h(`<span class="num">${number}</span>`));
  else gutter.append(h(`<span class="kind-icon">${I[kind] || I.text}</span>`));
  if (!ro) {
    const grip = h(`<button class="icon-btn drag" title="Drag to reorder" aria-label="Drag to reorder">${I.grip}</button>`);
    gutter.append(grip);
    wireDrag(el, grip, step);
  }

  if (kind === 'tip' || kind === 'alert') body.append(h(`<div class="callout-label">${kind === 'tip' ? 'Tip' : 'Important'}</div>`));

  const text = h(`<div class="b-text" data-placeholder="${escapeHtml(PLACEHOLDER[kind] || '')}"></div>`);
  text.innerHTML = kind === 'heading' ? escapeHtml(step.text || '') : richToHtml(step.text || '');
  if (!ro) wireEditable(text, step, 'text', { rich: kind !== 'heading' });
  body.append(text);

  if (isNumbered(step)) {
    const note = h('<div class="b-note" data-placeholder="Add a note…"></div>');
    note.innerHTML = richToHtml(step.note || '');
    note.hidden = !step.note && !step.showNote;
    if (!ro) wireEditable(note, step, 'note', { rich: true });
    body.append(note);

    if (step.href && step.action === 'navigate') {
      const a = h('<a class="b-url" target="_blank" rel="noopener"></a>');
      a.href = step.href;
      a.textContent = step.href;
      body.append(a);
    }

    // Desktop captures: which app and window the step happened in.
    if (step.app && !step.url) {
      const ctx = h('<div class="b-context"></div>');
      ctx.textContent = [step.app, step.window && step.window !== step.app ? step.window : ''].filter(Boolean).join(' · ');
      body.append(ctx);
    }

    if (step.screenshot && step.hideImage) {
      const hidden = h(`<div class="hidden-shot">${I.eyeOff} Screenshot hidden <button>Show</button></div>`);
      if (!ro) $('button', hidden).addEventListener('click', () => mutate(() => (step.hideImage = false)));
      else $('button', hidden).remove();
      body.append(hidden);
    } else if (step.screenshot) {
      const shot = h(`<div class="shot"><div class="placeholder"></div>
        <div class="shot-tools">
          <button data-shot="edit">${I.edit} Edit screenshot</button>
          <button data-shot="hide" aria-label="Hide screenshot" title="Hide screenshot">${I.eyeOff}</button>
        </div></div>`);
      if (ro) $('.shot-tools', shot).remove();
      renderStepImage(step, { maxWidth: 1400 }).then((img) => {
        if (!img) return;
        const image = new Image();
        image.src = img.dataUrl;
        image.width = img.width;
        image.height = img.height;
        image.alt = `Screenshot for step ${number}`;
        image.decoding = 'async';
        $('.placeholder', shot)?.replaceWith(image);
      });
      if (!ro) {
        $('[data-shot="edit"]', shot).addEventListener('click', () =>
          openImageEditor(step, { onSave: (edits) => mutate(() => Object.assign(step, edits)) }),
        );
        $('[data-shot="hide"]', shot).addEventListener('click', () => mutate(() => (step.hideImage = true)));
        shot.addEventListener('dblclick', (e) => {
          if (e.target.closest('.shot-tools')) return;
          openImageEditor(step, { onSave: (edits) => mutate(() => Object.assign(step, edits)) });
        });
      }
      body.append(shot);
    }
  }

  if (!ro) el.append(blockTools(step, index));
  return el;
}

function blockTools(step, index) {
  const tools = h('<div class="b-tools"></div>');
  const add = (icon, label, run, extra = '') => {
    const b = h(`<button class="icon-btn ${extra}" title="${label}" aria-label="${label}">${icon}</button>`);
    b.addEventListener('click', run);
    tools.append(b);
    return b;
  };
  const last = current.steps.length - 1;
  const move = (dir) =>
    mutate(() => {
      const [s] = current.steps.splice(index, 1);
      current.steps.splice(index + dir, 0, s);
    });
  add(I.up, 'Move up', () => move(-1)).disabled = index === 0;
  add(I.down, 'Move down', () => move(1)).disabled = index === last;
  if (step.kind === 'action' && step.screenshot && (step.target || step.click)) {
    add(I.target, step.highlight === false ? 'Show click highlight' : 'Hide click highlight', () =>
      mutate(() => (step.highlight = step.highlight === false)),
      step.highlight === false ? '' : 'on',
    );
  }
  add(I.more, 'More', (e) => {
    const items = [];
    if (isNumbered(step)) {
      items.push({
        label: step.note || step.showNote ? 'Remove note' : 'Add note',
        icon: I.note,
        run: () => {
          if (step.note || step.showNote) mutate(() => ((step.note = ''), (step.showNote = false)));
          else {
            step.showNote = true;
            renderBlocks();
            view.querySelector(`[data-id="${step.id}"] .b-note`)?.focus();
          }
        },
      });
      items.push({
        label: step.screenshot ? 'Replace screenshot' : 'Add image',
        icon: I.image,
        run: () => replaceImage(step),
      });
      if (step.screenshot) {
        items.push({ label: 'Edit screenshot', icon: I.edit, run: () => openImageEditor(step, { onSave: (edits) => mutate(() => Object.assign(step, edits)) }) });
        items.push({ label: step.hideImage ? 'Show screenshot' : 'Hide screenshot', icon: I.eyeOff, run: () => mutate(() => (step.hideImage = !step.hideImage)) });
      }
    }
    items.push({
      label: 'Duplicate',
      icon: I.dup,
      run: () => mutate(() => current.steps.splice(index + 1, 0, { ...structuredClone(step), id: newId('s') })),
    });
    items.push('-', { label: 'Insert below', icon: I.plus, run: () => openMenu(e.target.closest('button'), insertItems(index + 1)) });
    items.push('-', { label: 'Delete', icon: I.trash, danger: true, run: () => mutate(() => current.steps.splice(index, 1)) });
    openMenu(e.currentTarget, items);
  });
  return tools;
}

async function replaceImage(step) {
  const file = await pickFile($('#imageFile'));
  if (!file) return;
  const dataUrl = await readFileAsDataUrl(file);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = dataUrl;
  });
  mutate(() =>
    Object.assign(step, {
      screenshot: dataUrl,
      shot: { width: img.naturalWidth, height: img.naturalHeight, viewportW: img.naturalWidth, viewportH: img.naturalHeight },
      target: null,
      click: null,
      redactions: [],
      crop: null,
      hideImage: false,
    }),
  );
}

function wireEditable(el, step, field, { rich }) {
  el.contentEditable = 'true';
  el.spellcheck = true;
  let before = null;
  el.addEventListener('focus', () => {
    before = snapshot();
  });
  el.addEventListener('input', () => {
    step[field] = rich ? htmlToRich(el) : el.innerText.trim();
    scheduleSave();
    renderOutline(blockNumberMap());
  });
  el.addEventListener('blur', () => {
    const changed = before && JSON.stringify(before.steps.find((s) => s.id === step.id)?.[field] || '') !== JSON.stringify(step[field] || '');
    if (changed) {
      undoStack.push(before);
      redoStack = [];
      updateHistoryButtons();
    }
    before = null;
    if (field === 'note' && !step.note) {
      step.showNote = false;
      el.hidden = true;
    }
  });
  el.addEventListener('paste', (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain').replace(/\s*\n\s*/g, ' ');
    document.execCommand('insertText', false, text);
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      el.blur();
    }
    if (!rich && (e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) e.preventDefault();
  });
}

let dragId = null;
function wireDrag(el, grip, step) {
  grip.addEventListener('pointerdown', () => (el.draggable = true));
  el.addEventListener('dragstart', (e) => {
    dragId = step.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', step.id);
    requestAnimationFrame(() => el.classList.add('dragging'));
  });
  el.addEventListener('dragend', () => {
    el.draggable = false;
    el.classList.remove('dragging');
    dragId = null;
    view.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  });
  el.addEventListener('dragover', (e) => {
    if (!dragId || dragId === step.id) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    el.classList.toggle('drop-after', after);
    el.classList.toggle('drop-before', !after);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-before', 'drop-after'));
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    if (!dragId || dragId === step.id) return;
    const after = el.classList.contains('drop-after');
    const moving = dragId;
    mutate(() => {
      const from = current.steps.findIndex((s) => s.id === moving);
      const [s] = current.steps.splice(from, 1);
      let to = current.steps.findIndex((x) => x.id === step.id);
      if (after) to += 1;
      current.steps.splice(to, 0, s);
    });
  });
}

// ---------- export dialog ----------

const PREFS_KEY = 'flowdoc.exportPrefs';
function loadPrefs() {
  try {
    return { format: 'pdf', images: true, pageSize: 'a4', embedImages: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { format: 'pdf', images: true, pageSize: 'a4', embedImages: false };
  }
}

function openExportDialog(guide) {
  const prefs = loadPrefs();
  const dlg = h(`<dialog><form class="dlg" method="dialog">
    <h2>Export guide</h2>
    <p class="sub">Download “${escapeHtml(guide.title || 'Untitled guide')}” to share it anywhere.</p>
    <div class="formats" role="radiogroup" aria-label="Format">
      ${FORMATS.map(
        (f) => `<label class="format"><input type="radio" name="format" value="${f.id}" ${f.id === prefs.format ? 'checked' : ''}>
          <strong>${f.label} <span class="ext">.${f.ext}</span></strong><span>${f.desc}</span></label>`,
      ).join('')}
    </div>
    <div class="options">
      <label class="check opt-images"><input type="checkbox" name="images" ${prefs.images ? 'checked' : ''}> Include screenshots</label>
      <label class="check opt-page">Page size
        <select name="pageSize"><option value="a4">A4</option><option value="letter">US Letter</option></select></label>
      <label class="check opt-embed"><input type="checkbox" name="embedImages" ${prefs.embedImages ? 'checked' : ''}> Single .md file (images inlined)</label>
    </div>
    <div class="dlg-foot">
      <button type="button" class="secondary" data-close>Cancel</button>
      <button type="submit" class="primary go">${I.download} Export</button>
    </div>
  </form></dialog>`);
  const form = $('form', dlg);
  form.pageSize.value = prefs.pageSize;
  const sync = () => {
    const f = form.format.value;
    $('.opt-images', dlg).hidden = f === 'json';
    $('.opt-page', dlg).hidden = !['pdf', 'docx'].includes(f);
    $('.opt-embed', dlg).hidden = f !== 'markdown';
  };
  form.addEventListener('change', sync);
  sync();
  $('[data-close]', dlg).addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const options = {
      format: form.format.value,
      images: form.images.checked,
      pageSize: form.pageSize.value,
      embedImages: form.embedImages.checked,
    };
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(options));
    } catch {}
    const go = $('.go', dlg);
    go.disabled = true;
    go.textContent = 'Exporting…';
    try {
      await flushSave();
      const { blob, filename } = await exportGuide(guide, options.format, options);
      download(blob, filename);
      dlg.close();
      toast(`Exported ${filename}`);
    } catch (err) {
      console.error(err);
      toast(`Export failed: ${err.message}`, { error: true });
      go.disabled = false;
      go.innerHTML = `${I.download} Export`;
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}

// ---------- live updates from the recorder ----------

let pendingKeys = new Set();
let pendingTimer = 0;
function onStoreChange(keys) {
  keys.forEach((k) => pendingKeys.add(k));
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(async () => {
    const changed = pendingKeys;
    pendingKeys = new Set();
    if (current && current.recording && changed.has(`guide_${current.id}`)) {
      const y = window.scrollY;
      await renderEditor(current.id);
      window.scrollTo(0, y);
    } else if (!current && changed.has('guides_index')) {
      renderHome();
    } else if (changed.has('guides_index')) {
      renderSidebar(current?.id);
    }
  }, 150);
}

if (isExtension) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') onStoreChange(Object.keys(changes));
  });
}

if (isDesktop) {
  desktop.onStoreChange(({ key }) => onStoreChange([key]));

  // The sidebar button doubles as Stop while a capture is running.
  const cta = $('#howToCapture');
  const renderCta = (s) => {
    cta.classList.toggle('recording', !!s?.active);
    cta.innerHTML = s?.active ? `<span class="rec"></span> Stop capture (${s.stepCount})` : '<span class="rec"></span> New capture';
  };
  desktop.recorder.onState(renderCta);
  desktop.recorder.state().then(renderCta);

  desktop.recorder.onFinished(async ({ guideId }) => {
    location.hash = `#/guide/${guideId}`;
    await route();
    const s = await desktop.settings.get();
    if (s.ai.autoEnhance && current?.id === guideId && (await aiEnabled())) runAiImprove(true);
  });

  const settingsBtn = h(`<button class="nav-item settings-btn">${I.gear} Settings</button>`);
  settingsBtn.addEventListener('click', () =>
    // The AI button depends on the settings, so refresh the editor afterwards.
    openSettingsDialog({ toast, onClose: () => current && !current.recording && renderEditor(current.id) }),
  );
  $('.sidebar-foot').prepend(settingsBtn);
}

// ---------- theme toggle (System / Light / Dark) ----------
{
  const buttons = document.querySelectorAll('[data-theme-mode]');
  const sync = () => buttons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeMode === globalThis.flowdocTheme?.mode)));
  buttons.forEach((b) => b.addEventListener('click', () => globalThis.flowdocTheme?.set(b.dataset.themeMode)));
  globalThis.flowdocTheme?.onChange(sync);
  sync();
}

// Test hook for the end-to-end suites.
window.flowdocApp = { exportGuide, getGuide, openSample, runAiImprove, route };

route();
