// "Save to Notion" (desktop). Connect once with an integration token, then
// pick where the guide goes: browse into pages and subpages like folders,
// reuse a recent destination, or one of up to 10 saved, named locations.
import { buildExportModel, escapeHtml, formatDate, parseRuns } from './render.js';

const desktop = globalThis.flowdocDesktop;
const INTEGRATIONS_URL = 'https://www.notion.so/profile/integrations';
const MAX_SAVED = 10;

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const cleanError = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const CONNECT_STEPS = `
  <ol class="howto">
    <li>Open <a href="#" data-url="${INTEGRATIONS_URL}">notion.so/profile/integrations</a> and click <b>New integration</b>.</li>
    <li>Name it <b>FlowDoc</b>, choose your workspace, and keep the type <b>Internal</b>. Save.</li>
    <li>Under <b>Capabilities</b>, make sure <b>Read content</b>, <b>Insert content</b> and <b>Update content</b> are ticked.</li>
    <li>Copy the <b>Internal Integration Secret</b> (starts with <code>ntn_</code>) and paste it below.</li>
    <li>In Notion, open the page where guides should go, click <b>•••</b> → <b>Connections</b> and add <b>FlowDoc</b>. Pages inside it are included automatically.</li>
  </ol>`;

// Export model with the bold/plain text pieces Notion needs.
async function notionModel(guide, images) {
  const model = await buildExportModel(guide, { images });
  return {
    title: model.title,
    description: model.description,
    stepCount: model.stepCount,
    blocks: model.blocks.map((b) => ({
      kind: b.kind,
      number: b.number,
      text: b.text.replace(/\*\*/g, ''),
      runs: parseRuns(b.text),
      noteRuns: b.note ? parseRuns(b.note) : [],
      url: b.url,
      image: b.image ? { dataUrl: b.image.dataUrl } : null,
    })),
  };
}

const pathText = (crumbs) => crumbs.map((c) => c.title).join(' / ');
const locationOf = (crumbs) => {
  const last = crumbs.at(-1);
  return { id: last.id, title: last.title, path: pathText(crumbs), crumbs: crumbs.map(({ id, title }) => ({ id, title })) };
};

/**
 * @param onSaved ({ pageId, url, parentId, parentPath, savedAt }) — store it on the guide
 */
export async function openNotionDialog(guide, { toast, onSaved }) {
  let settings = await desktop.settings.get();
  const dlg = h(`<dialog><div class="dlg notion">
    <h2>Save to Notion</h2>
    <section class="connect" hidden>
      <p class="sub">Connect FlowDoc to your Notion workspace once. Everything stays between this computer and Notion.</p>
      ${CONNECT_STEPS}
      <div class="inline"><input name="token" type="password" placeholder="ntn_…" autocomplete="off" spellcheck="false"><button class="primary" data-act="connect">Connect</button></div>
      <p class="error-text" hidden></p>
    </section>
    <section class="pick" hidden>
      <p class="sub who"></p>
      <div class="places">
        <div class="place-group saved-group">
          <h4>Saved locations <span class="count"></span></h4>
          <div class="chips"></div>
        </div>
        <div class="place-group recent-group">
          <h4>Recent</h4>
          <div class="recent-list"></div>
        </div>
      </div>
      <div class="browse">
        <div class="browse-head">
          <nav class="crumbs" aria-label="Location"></nav>
          <button class="ghost star" data-act="star" title="Save this location with a name">★ Save location</button>
        </div>
        <div class="name-row" hidden>
          <input name="locName" maxlength="40" placeholder="Name, e.g. AWS LEARNING" aria-label="Location name">
          <button class="primary" data-act="saveLoc">Save</button>
          <button class="ghost" data-act="cancelLoc">Cancel</button>
        </div>
        <p class="hint limit-msg" hidden></p>
        <label class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" name="q" placeholder="Search all pages" aria-label="Search all pages"></label>
        <div class="tree" role="listbox" aria-label="Pages"></div>
      </div>
      <p class="hint selected-path"></p>
      <div class="field-row"><label for="nTitle">Page title</label><input id="nTitle" name="title"></div>
      <label class="check"><input type="checkbox" name="images" checked> Include screenshots</label>
      ${guide.notion?.pageId ? `<label class="check"><input type="checkbox" name="replace"> Replace the copy saved on ${escapeHtml(formatDate(guide.notion.savedAt))} (moves it to Notion's trash)</label>` : ''}
      <p class="error-text" hidden></p>
    </section>
    <section class="saving" hidden>
      <p class="phase">Uploading screenshots…</p>
      <div class="progress"><div class="bar"><span></span></div></div>
      <p class="hint status"></p>
    </section>
    <section class="done" hidden>
      <p class="saved-msg">✓ Saved to Notion</p>
      <p class="hint saved-path"></p>
    </section>
    <div class="dlg-foot">
      <button class="secondary" data-act="cancel">Cancel</button>
      <button class="primary" data-act="save" hidden>Save to Notion</button>
      <button class="primary" data-act="open" hidden>Open in Notion</button>
    </div>
  </div></dialog>`);
  const $ = (sel) => dlg.querySelector(sel);
  const show = (name) => ['connect', 'pick', 'saving', 'done'].forEach((n) => ($(`.${n}`).hidden = n !== name));
  const showError = (section, msg) => {
    const el = $(`.${section} .error-text`);
    el.hidden = !msg;
    el.textContent = msg || '';
  };

  let roots = []; // top-level pages
  const children = new Map(); // pageId -> [{ id, title }]
  let crumbs = []; // current location, top-down; empty = workspace
  let savedUrl = null;
  let searchTimer = 0;
  let searchSeq = 0;
  $('[name="title"]').value = guide.title || 'Untitled guide';

  // ---------- saved & recent ----------

  function renderPlaces() {
    const saved = settings.notion?.saved || [];
    const recents = settings.notion?.recents || [];
    $('.count').textContent = `${saved.length}/${MAX_SAVED}`;
    const chips = $('.chips');
    chips.replaceChildren();
    if (!saved.length) chips.append(h('<span class="hint">Save a location with ★ to reach it in one click next time.</span>'));
    for (const loc of saved) {
      const chip = h(`<span class="chip" title=""><button class="chip-go"></button><button class="chip-x" aria-label="Remove saved location">✕</button></span>`);
      chip.title = loc.path;
      chip.querySelector('.chip-go').textContent = `★ ${loc.name}`;
      chip.querySelector('.chip-go').addEventListener('click', () => goTo(loc.crumbs, loc.path));
      chip.querySelector('.chip-x').addEventListener('click', () => removeSaved(loc.id));
      chips.append(chip);
    }
    const list = $('.recent-list');
    list.replaceChildren();
    $('.recent-group').hidden = !recents.length;
    for (const loc of recents) {
      const row = h('<button class="recent-row"><span class="r-path"></span></button>');
      row.querySelector('.r-path').textContent = loc.path;
      row.title = `Go to ${loc.path}`;
      row.addEventListener('click', () => goTo(loc.crumbs, loc.path));
      list.append(row);
    }
    renderStar();
  }

  function renderStar() {
    const saved = settings.notion?.saved || [];
    const here = crumbs.at(-1);
    const already = here && saved.find((s) => s.id === here.id);
    const full = saved.length >= MAX_SAVED;
    const star = $('[data-act="star"]');
    star.hidden = !here;
    star.disabled = !!already || full;
    star.textContent = already ? `★ Saved as “${already.name}”` : '★ Save location';
    const msg = $('.limit-msg');
    msg.hidden = !(here && full && !already);
    msg.textContent = `You have ${MAX_SAVED} saved locations, the most you can keep. Remove one (✕) to save this one.`;
  }

  async function storeSaved(list) {
    try {
      settings = await desktop.notion.setSaved(list);
      renderPlaces();
      return true;
    } catch (err) {
      toast(cleanError(err), { error: true });
      return false;
    }
  }

  async function removeSaved(id) {
    const loc = (settings.notion.saved || []).find((s) => s.id === id);
    if (await storeSaved((settings.notion.saved || []).filter((s) => s.id !== id))) toast(`Removed “${loc?.name}” from saved locations`);
  }

  // ---------- browsing ----------

  async function loadChildren(id) {
    if (!children.has(id)) children.set(id, await desktop.notion.children(id));
    return children.get(id);
  }

  async function goTo(newCrumbs, label) {
    $('[name="q"]').value = '';
    crumbs = (newCrumbs || []).map(({ id, title }) => ({ id, title }));
    showError('pick', '');
    await renderBrowse(label);
  }

  async function renderBrowse() {
    // Path bar: Workspace › Page › Subpage (each part is clickable).
    const nav = $('.crumbs');
    nav.replaceChildren();
    const part = (label, idx) => {
      const b = h('<button class="crumb"></button>');
      b.textContent = label;
      b.addEventListener('click', () => goTo(crumbs.slice(0, idx)));
      return b;
    };
    nav.append(part(settings.workspaceName || 'Workspace', 0));
    crumbs.forEach((c, i) => {
      nav.append(h('<span class="sep">›</span>'));
      const b = part(c.title, i + 1);
      if (i === crumbs.length - 1) b.setAttribute('aria-current', 'page');
      nav.append(b);
    });

    const box = $('.tree');
    const here = crumbs.at(-1);
    box.innerHTML = '<div class="empty-tree">Loading…</div>';
    let list;
    try {
      list = here ? await loadChildren(here.id) : roots;
    } catch (err) {
      box.innerHTML = '';
      showError('pick', cleanError(err));
      return;
    }
    if (crumbs.at(-1) !== here) return; // navigated elsewhere meanwhile
    box.replaceChildren();
    if (!here && !list.length) {
      box.append(h(`<div class="empty-tree">No pages are shared with FlowDoc yet. In Notion, open the page where guides should go, click <b>•••</b> → <b>Connections</b>, add <b>FlowDoc</b>, then reopen this window.</div>`));
    } else if (!list.length) {
      box.append(h('<div class="empty-tree">No subpages here. The guide will be saved inside this page.</div>'));
    }
    for (const page of list) box.append(pageRow(page, () => goTo([...crumbs, page])));
    renderSelection();
    renderStar();
  }

  function pageRow(page, open, detail = '') {
    const row = h(`<button class="node" role="option"><span class="icon">${escapeHtml(page.icon || '📄')}</span><span class="title"></span><span class="detail"></span><span class="chev">›</span></button>`);
    row.querySelector('.title').textContent = page.title;
    row.querySelector('.detail').textContent = detail;
    row.title = `Open ${page.title}`;
    row.addEventListener('click', open);
    return row;
  }

  function renderSelection() {
    const here = crumbs.at(-1);
    $('.selected-path').innerHTML = here ? 'Saving under: <b></b>' : 'Open a page to choose where the guide goes.';
    if (here) $('.selected-path b').textContent = pathText(crumbs);
    $('[data-act="save"]').disabled = !here;
  }

  // Search the whole workspace (Notion's own search), then jump to the hit.
  async function runSearch(q) {
    const seq = ++searchSeq;
    const box = $('.tree');
    box.innerHTML = '<div class="empty-tree">Searching…</div>';
    try {
      const hits = await desktop.notion.pages(q);
      if (seq !== searchSeq) return;
      box.replaceChildren();
      if (!hits.length) box.append(h('<div class="empty-tree">No pages match. Only pages shared with FlowDoc can be found.</div>'));
      const titles = new Map(hits.map((p) => [p.id, p.title]));
      for (const p of hits.slice(0, 100)) {
        const parent = p.parentId && titles.get(p.parentId);
        box.append(
          pageRow(p, async () => {
            box.innerHTML = '<div class="empty-tree">Opening…</div>';
            try {
              await goTo(await desktop.notion.path(p.id));
            } catch (err) {
              showError('pick', cleanError(err));
            }
          }, parent ? `in ${parent}` : ''),
        );
      }
    } catch (err) {
      if (seq === searchSeq) showError('pick', cleanError(err));
    }
  }

  async function loadPicker() {
    show('pick');
    $('[data-act="save"]').hidden = false;
    $('[data-act="save"]').disabled = true;
    $('.tree').innerHTML = '<div class="empty-tree">Loading your Notion pages…</div>';
    try {
      const [me, pages] = await Promise.all([desktop.notion.me(), desktop.notion.pages('')]);
      settings.workspaceName = me.workspace || me.name;
      $('.who').innerHTML = 'Connected to <b></b>. Open pages and subpages to choose where this guide goes.';
      $('.who b').textContent = settings.workspaceName;
      const ids = new Set(pages.map((p) => p.id));
      roots = pages.filter((p) => !p.parentId || !ids.has(p.parentId)).sort((a, b) => a.title.localeCompare(b.title));
      renderPlaces();
      // Start where the guide was saved last time, or at the most recent destination.
      const start = guide.notion?.parentId && settings.notion.recents?.find((r) => r.id === guide.notion.parentId);
      await goTo((start || settings.notion.recents?.[0])?.crumbs || []);
    } catch (err) {
      if (/401|token|Connect Notion/.test(cleanError(err))) {
        show('connect');
        $('[data-act="save"]').hidden = true;
        showError('connect', cleanError(err));
      } else {
        $('.tree').innerHTML = '';
        showError('pick', cleanError(err));
      }
    }
  }

  async function save() {
    const location = locationOf(crumbs);
    show('saving');
    $('[data-act="save"]').hidden = true;
    $('[data-act="cancel"]').disabled = true;
    const off = desktop.notion.onProgress(({ phase, done, total }) => {
      $('.phase').textContent = phase === 'images' ? 'Uploading screenshots…' : 'Writing the page…';
      $('.bar span').style.width = `${total ? Math.round((done / total) * 100) : 100}%`;
      $('.status').textContent = phase === 'images' ? `${done} of ${total} screenshots` : `${done} of ${total} blocks`;
    });
    try {
      const model = await notionModel(guide, $('[name="images"]').checked);
      const result = await desktop.notion.save({
        parentId: location.id,
        location,
        title: $('[name="title"]').value.trim() || guide.title,
        model,
        replacePageId: $('[name="replace"]')?.checked ? guide.notion.pageId : null,
      });
      savedUrl = result.url;
      onSaved({ pageId: result.id, url: result.url, parentId: location.id, parentPath: location.path, savedAt: Date.now() });
      show('done');
      $('.saved-path').textContent = `In ${location.path}`;
      $('[data-act="open"]').hidden = false;
      $('[data-act="cancel"]').textContent = 'Close';
      toast('Saved to Notion');
    } catch (err) {
      show('pick');
      $('[data-act="save"]').hidden = false;
      showError('pick', cleanError(err));
    } finally {
      off();
      $('[data-act="cancel"]').disabled = false;
    }
  }

  // ---------- events ----------

  $('[data-act="connect"]').addEventListener('click', async () => {
    const token = $('[name="token"]').value.trim();
    if (!token) return showError('connect', 'Paste your integration secret first.');
    showError('connect', '');
    settings = await desktop.settings.setKey('notion', token);
    loadPicker();
  });
  $('[name="q"]').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    if (!q) return renderBrowse();
    searchTimer = setTimeout(() => runSearch(q), 300);
  });
  $('[data-act="star"]').addEventListener('click', () => {
    $('.name-row').hidden = false;
    $('[name="locName"]').value = crumbs.at(-1)?.title.slice(0, 40) || '';
    $('[name="locName"]').select();
  });
  $('[data-act="cancelLoc"]').addEventListener('click', () => ($('.name-row').hidden = true));
  const saveLocation = async () => {
    const name = $('[name="locName"]').value.trim();
    if (!name || !crumbs.length) return;
    const saved = settings.notion.saved || [];
    if (saved.length >= MAX_SAVED) return renderStar();
    if (await storeSaved([...saved, { name, ...locationOf(crumbs) }])) {
      $('.name-row').hidden = true;
      toast(`Saved “${name}”`);
    }
  };
  $('[data-act="saveLoc"]').addEventListener('click', saveLocation);
  $('[name="locName"]').addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), saveLocation()));
  $('[data-act="save"]').addEventListener('click', save);
  $('[data-act="open"]').addEventListener('click', () => savedUrl && desktop.openExternal(savedUrl));
  $('[data-act="cancel"]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-url]');
    if (a) {
      e.preventDefault();
      desktop.openExternal(a.dataset.url);
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();

  if (settings.keys.notion) loadPicker();
  else show('connect');
}
