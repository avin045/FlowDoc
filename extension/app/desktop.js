// Desktop-only workspace UI: settings (optional AI provider + capture
// options) and the "Improve with AI" flow.
import { STYLES, testConnection } from './ai.js';
import { cancelJob, estimateRemaining, getJob, onJobChange, startJob } from './aiJobs.js';
import { CONNECT_STEPS } from './notion.js';
import { escapeHtml, isNumbered } from './render.js';

const desktop = globalThis.flowdocDesktop;

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export async function aiEnabled() {
  if (!desktop) return false;
  const s = await desktop.settings.get();
  return s.ai.provider !== 'off' && !!s.keys[s.ai.provider];
}

// ---------- settings ----------

export async function openSettingsDialog({ toast, onClose }) {
  let s = await desktop.settings.get();
  const dlg = h(`<dialog><form class="dlg settings" method="dialog">
    <h2>Settings</h2>
    <p class="sub">Everything stays on this computer. API keys are encrypted with your system keychain${s.secureStorage ? '' : ' <b>(keychain unavailable: stored obfuscated only)</b>'}.</p>

    <h3>Guides folder</h3>
    <p class="hint">Where FlowDoc keeps your guides on this computer. Choose any folder, for example in Documents or on another drive.</p>
    <div class="folder-box"><span class="folder-path"></span><span class="pill folder-kind"></span></div>
    <p class="notice folder-warning" hidden></p>
    <div class="inline folder-actions">
      <button type="button" class="secondary" data-act="chooseFolder">Change folder…</button>
      <button type="button" class="ghost" data-act="openFolder">Open folder</button>
      <button type="button" class="ghost" data-act="resetFolder">Use default</button>
    </div>
    <div class="folder-confirm" hidden>
      <p class="confirm-text"></p>
      <label class="check copy-row"><input type="checkbox" name="copyGuides" checked> <span class="copy-label"></span></label>
      <div class="inline">
        <button type="button" class="primary" data-act="applyFolder">Use this folder</button>
        <button type="button" class="ghost" data-act="cancelFolder">Cancel</button>
      </div>
    </div>
    <p class="error-text folder-error" hidden></p>

    <h3>AI assistant <span class="pill">Optional</span></h3>
    <p class="hint">Rewrites step instructions from the screenshots and writes the guide title and description. Uses your own API key; screenshots of each step are sent to the provider you choose.</p>
    <div class="field-row">
      <label for="aiProvider">Provider</label>
      <select id="aiProvider" name="provider">
        <option value="off">Off</option>
        ${Object.entries(s.providers).map(([id, p]) => `<option value="${id}">${escapeHtml(p.label)}</option>`).join('')}
      </select>
    </div>
    <div class="ai-fields">
      <div class="field-row">
        <label for="aiKey">API key</label>
        <div class="inline">
          <input id="aiKey" name="key" type="password" autocomplete="off" spellcheck="false">
          <button type="button" class="secondary" data-act="saveKey">Save key</button>
        </div>
      </div>
      <p class="hint key-hint"></p>
      <div class="field-row">
        <label for="aiModel">Model</label>
        <div class="inline">
          <select id="aiModel" name="model"></select>
          <button type="button" class="secondary" data-act="models">Load models</button>
        </div>
      </div>
      <div class="field-row custom-model" hidden>
        <span></span>
        <input name="customModel" type="text" spellcheck="false" placeholder="Exact model ID, e.g. gemini-3.6-flash">
      </div>
      <div class="field-row">
        <span></span>
        <div class="inline">
          <button type="button" class="secondary" data-act="test">Test connection</button>
          <span class="test-result hint"></span>
        </div>
      </div>
    </div>

    <h3>Notion <span class="pill">Optional</span></h3>
    <p class="hint">Save guides as Notion pages, with screenshots, under any page you choose.</p>
    <details class="notion-help"><summary>How to get a Notion integration secret</summary>${CONNECT_STEPS}</details>
    <div class="field-row">
      <label for="notionToken">Secret</label>
      <div class="inline">
        <input id="notionToken" name="notionToken" type="password" autocomplete="off" spellcheck="false">
        <button type="button" class="secondary" data-act="saveNotion">Save</button>
      </div>
    </div>
    <div class="field-row">
      <span></span>
      <div class="inline">
        <button type="button" class="secondary" data-act="testNotion">Test connection</button>
        <button type="button" class="ghost danger" data-act="disconnectNotion">Disconnect</button>
        <span class="notion-result hint"></span>
      </div>
    </div>

    <h3>Capture</h3>
    <label class="check"><input type="checkbox" name="hideWindow"> Minimise FlowDoc while capturing</label>
    <label class="check"><input type="checkbox" name="typedText"> Include typed text in steps (passwords are always hidden)</label>
    <label class="check"><input type="checkbox" name="unknownFieldText"> Also include keystrokes when the field type can't be detected</label>
    <p class="hint">Shortcut to start or stop a capture from anywhere: <kbd>Alt</kbd> + <kbd>Shift</kbd> + <kbd>R</kbd></p>

    <div class="dlg-foot"><button type="button" class="primary" data-close>Done</button></div>
  </form></dialog>`);
  const f = dlg.querySelector('form');
  const $ = (sel) => dlg.querySelector(sel);

  const fill = () => {
    f.provider.value = s.ai.provider;
    const p = s.ai.provider;
    $('.ai-fields').hidden = p === 'off';
    if (p !== 'off') {
      f.key.value = '';
      f.key.placeholder = s.keys[p] ? 'Saved — paste a new key to replace it' : `Paste your ${s.providers[p].label} API key`;
      $('.key-hint').innerHTML = `Get a key at <a href="#" data-url="${s.providers[p].keyUrl}">${escapeHtml(s.providers[p].keyUrl.replace('https://', ''))}</a>`;
      fillModels();
    }
    f.hideWindow.checked = s.capture.hideWindow;
    f.typedText.checked = s.capture.typedText;
    f.unknownFieldText.checked = s.capture.unknownFieldText;
    f.unknownFieldText.disabled = !s.capture.typedText;
    $('.test-result').textContent = '';
    f.notionToken.value = '';
    f.notionToken.placeholder = s.keys.notion ? 'Connected — paste a new secret to replace it' : 'ntn_…';
    $('[data-act="disconnectNotion"]').hidden = !s.keys.notion;
    $('[data-act="testNotion"]').disabled = !s.keys.notion;
  };

  // A real <select>: recommended models first, then everything "Load models"
  // found for this key (remembered between sessions), then "Other…".
  function fillModels() {
    const p = s.ai.provider;
    const current = s.ai.models[p] || s.providers[p].defaultModel;
    const recommended = [...new Set([s.providers[p].defaultModel, ...(s.providers[p].fallbacks || [])])];
    const loaded = (s.ai.modelLists?.[p] || []).filter((m) => !recommended.includes(m));
    const opt = (m, label = m) => `<option value="${escapeHtml(m)}">${escapeHtml(label)}</option>`;
    const known = new Set([...recommended, ...loaded]);
    f.model.innerHTML =
      `<optgroup label="Recommended">${recommended.map((m, i) => opt(m, i === 0 ? `${m} (default, fast)` : m)).join('')}</optgroup>` +
      (loaded.length ? `<optgroup label="All models for your key (${loaded.length})">${loaded.map((m) => opt(m)).join('')}</optgroup>` : '') +
      (!known.has(current) ? `<optgroup label="Current">${opt(current)}</optgroup>` : '') +
      `<option value="__custom">Other — type a model ID…</option>`;
    f.model.value = current;
    $('.custom-model').hidden = true;
  }
  const chosenModel = () =>
    f.model.value === '__custom' ? f.customModel.value.trim() || s.providers[s.ai.provider].defaultModel : f.model.value;
  fill();

  const save = async (patch) => {
    s = await desktop.settings.update(patch);
  };
  f.provider.addEventListener('change', async () => {
    await save({ ai: { provider: f.provider.value } });
    fill();
  });
  f.model.addEventListener('change', () => {
    const custom = f.model.value === '__custom';
    $('.custom-model').hidden = !custom;
    if (custom) return f.customModel.focus();
    save({ ai: { models: { [s.ai.provider]: f.model.value } } });
  });
  f.customModel.addEventListener('change', () => {
    if (f.customModel.value.trim()) save({ ai: { models: { [s.ai.provider]: f.customModel.value.trim() } } });
  });
  for (const name of ['hideWindow', 'typedText', 'unknownFieldText'])
    f[name].addEventListener('change', async () => {
      await save({ capture: { [name]: f[name].checked } });
      f.unknownFieldText.disabled = !s.capture.typedText;
    });

  $('[data-act="saveKey"]').addEventListener('click', async () => {
    const key = f.key.value.trim();
    if (!key) return toast('Paste a key first', { error: true });
    s = await desktop.settings.setKey(s.ai.provider, key);
    fill();
    toast('API key saved');
  });
  $('[data-act="models"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const models = await desktop.ai.listModels(s.ai.provider);
      s = await desktop.settings.update({ ai: { modelLists: { [s.ai.provider]: models } } });
      fillModels();
      toast(`${models.length} models loaded — choose one from the Model list`);
      f.model.focus();
    } catch (err) {
      toast(`Could not load models: ${cleanError(err)}`, { error: true });
    }
    btn.disabled = false;
  });
  $('[data-act="test"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = $('.test-result');
    btn.disabled = true;
    out.textContent = 'Testing…';
    try {
      const chosen = chosenModel();
      await save({ ai: { models: { [s.ai.provider]: chosen } } });
      const r = await testConnection(s.ai.provider);
      out.textContent = !r.ok
        ? 'Unexpected reply'
        : r.model === chosen
          ? `✓ Connected — ${r.model} answered in ${(r.ms / 1000).toFixed(1)} s`
          : `✓ Connected, but ${chosen} is busy — ${r.model} answered instead (${(r.ms / 1000).toFixed(1)} s)`;
    } catch (err) {
      out.textContent = `✗ ${cleanError(err)}`;
    }
    btn.disabled = false;
  });
  // ---------- guides folder ----------
  let folder = null; // { dir, defaultDir, isDefault, guides, fallback }
  let pendingFolder = null; // inspected target waiting for confirmation
  const folderError = (msg) => {
    $('.folder-error').hidden = !msg;
    $('.folder-error').textContent = msg || '';
  };
  async function renderFolder() {
    folder = await desktop.storage.get();
    $('.folder-path').textContent = folder.dir;
    $('.folder-kind').textContent = folder.isDefault ? 'Default' : 'Custom';
    $('[data-act="resetFolder"]').hidden = folder.isDefault;
    const warn = $('.folder-warning');
    warn.hidden = !folder.fallback;
    if (folder.fallback) warn.textContent = `Your guides folder ${folder.fallback.wanted} isn't available right now (for example, a drive that isn't connected), so FlowDoc is using the default folder. Reconnect it and restart FlowDoc, or choose another folder.`;
  }
  function confirmFolder(info, isReset) {
    pendingFolder = { ...info, isReset };
    const parts = [isReset ? `Guides will be stored in the default folder again: ${info.target}.` : `Guides will be stored in ${info.target}.`];
    if (info.subfolder) parts.push('A “FlowDoc Guides” folder is created inside the folder you picked, so your own files stay separate.');
    if (info.existingGuides) parts.push(`It already has ${info.existingGuides} FlowDoc guide${info.existingGuides === 1 ? '' : 's'}; they'll appear in your library.`);
    $('.confirm-text').textContent = parts.join(' ');
    $('.copy-label').textContent = `Copy my ${folder.guides} guide${folder.guides === 1 ? '' : 's'} there too (the current folder is kept as a backup)`;
    $('.copy-row').hidden = !folder.guides;
    f.copyGuides.checked = true;
    $('.folder-confirm').hidden = false;
    $('.folder-actions').hidden = true;
  }
  const closeConfirm = () => {
    pendingFolder = null;
    $('.folder-confirm').hidden = true;
    $('.folder-actions').hidden = false;
  };
  $('[data-act="chooseFolder"]').addEventListener('click', async () => {
    folderError('');
    const info = await desktop.storage.choose();
    if (!info) return;
    if (!info.ok) return folderError(info.reason);
    if (info.target === folder.dir) return folderError('FlowDoc is already using that folder.');
    confirmFolder(info, false);
  });
  $('[data-act="resetFolder"]').addEventListener('click', async () => {
    folderError('');
    confirmFolder(await desktop.storage.inspect(folder.defaultDir), true);
  });
  $('[data-act="cancelFolder"]').addEventListener('click', closeConfirm);
  $('[data-act="openFolder"]').addEventListener('click', () => desktop.storage.open());
  $('[data-act="applyFolder"]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const copy = folder.guides > 0 && f.copyGuides.checked;
      const res = pendingFolder.isReset ? await desktop.storage.reset({ copy }) : await desktop.storage.apply({ target: pendingFolder.target, copy });
      closeConfirm();
      await renderFolder();
      toast(`Guides are now stored in ${res.dir}${res.copied ? ` (${res.copied} copied)` : ''}`);
      location.hash = '#/'; // show the library from the new folder
    } catch (err) {
      folderError(cleanError(err));
    }
    btn.disabled = false;
  });
  renderFolder();

  $('[data-act="saveNotion"]').addEventListener('click', async () => {
    const token = f.notionToken.value.trim();
    if (!token) return toast('Paste your Notion secret first', { error: true });
    s = await desktop.settings.setKey('notion', token);
    fill();
    $('[data-act="testNotion"]').click();
  });
  $('[data-act="testNotion"]').addEventListener('click', async () => {
    const out = $('.notion-result');
    out.textContent = 'Testing…';
    try {
      const me = await desktop.notion.me();
      const pages = await desktop.notion.pages();
      out.textContent = `✓ Connected to ${me.workspace || me.name} · ${pages.length} page${pages.length === 1 ? '' : 's'} shared with it`;
    } catch (err) {
      out.textContent = `✗ ${cleanError(err)}`;
    }
  });
  $('[data-act="disconnectNotion"]').addEventListener('click', async () => {
    s = await desktop.settings.setKey('notion', '');
    fill();
    $('.notion-result').textContent = 'Disconnected. The secret was removed from this computer.';
  });
  dlg.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-url]');
    if (a) {
      e.preventDefault();
      desktop.openExternal(a.dataset.url);
    }
  });
  $('[data-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => {
    dlg.remove();
    onClose?.();
  });
  document.body.append(dlg);
  dlg.showModal();
}

export function cleanError(err) {
  return String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

// ---------- improve with AI ----------

const BIG_GUIDE = 20; // steps; above this, say it may take a while

function formatDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${String(s % 60).padStart(2, '0')} s`;
}

/**
 * The Improve with AI dialog. Choosing a style starts a background job
 * (aiJobs.js); the dialog then shows its progress and can be closed at any
 * time without stopping it. Applying the result is handled by the caller via
 * onJobChange, so it works even if this dialog is gone.
 */
export async function openImproveDialog(guide, { toast, auto = false }) {
  const s = await desktop.settings.get();
  const provider = s.providers[s.ai.provider];
  const model = s.ai.models[s.ai.provider];
  const total = guide.steps.filter((x) => isNumbered(x) && x.text).length;
  const style = STYLES[s.ai.style] ? s.ai.style : 'elaborate';

  const dlg = h(`<dialog><form class="dlg improve" method="dialog">
    <h2>Improve with AI</h2>
    <p class="sub">Uses ${escapeHtml(provider.label)} (<code>${escapeHtml(model)}</code>). You can undo the result with Ctrl+Z.</p>
    <div class="choose">
      <div class="styles" role="radiogroup" aria-label="Writing style">
        ${Object.entries(STYLES)
          .map(
            ([id, st]) => `<label class="style-card">
              <input type="radio" name="style" value="${id}" ${id === style ? 'checked' : ''}>
              <strong>${st.label}</strong>
              <span>${escapeHtml(st.blurb)}</span>
              <em>${st.images ? 'Sends screenshots' : 'Text only · fastest'}</em>
            </label>`,
          )
          .join('')}
      </div>
      <div class="opts">
        <label class="check"><input type="checkbox" name="steps" checked> Rewrite the ${total} step instructions</label>
        <label class="check"><input type="checkbox" name="summary" checked> Write the title and description</label>
      </div>
      ${total > BIG_GUIDE ? `<p class="notice">This guide has ${total} steps, so this can take a few minutes. It runs in the background: close this window and keep working, and FlowDoc will let you know when it's done.</p>` : ''}
    </div>
    <div class="progress" hidden>
      <p class="phase"></p>
      <div class="bar"><span></span></div>
      <p class="hint status"></p>
      <p class="hint bg-hint"></p>
    </div>
    <div class="dlg-foot">
      <button type="button" class="secondary" data-act="close">Cancel</button>
      <button type="button" class="secondary danger" data-act="stop" hidden>Stop</button>
      <button type="submit" class="primary go">✨ Improve</button>
    </div>
  </form></dialog>`);
  const f = dlg.querySelector('form');
  const $ = (sel) => dlg.querySelector(sel);
  let unsubscribe = () => {};

  function showProgress(job) {
    $('.choose').hidden = true;
    $('.progress').hidden = false;
    $('.go').hidden = true;
    $('[data-act="stop"]').hidden = job.status !== 'running';
    $('[data-act="close"]').textContent = job.status === 'running' ? 'Keep working' : 'Close';
    $('[data-act="close"]').title = 'The job keeps running in the background';
    $('.phase').textContent = `${STYLES[job.style].label} · ${job.phase}`;
    const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
    $('.bar span').style.width = `${job.status === 'running' && !job.total ? 8 : pct}%`;
    const elapsed = formatDuration(Date.now() - job.startedAt);
    const left = estimateRemaining(job);
    $('.status').textContent = job.total
      ? `${job.done} of ${job.total} steps done · ${elapsed}${left != null ? ` · about ${formatDuration(left)} left` : ''}`
      : `${elapsed}`;
    $('.bg-hint').textContent =
      job.status === 'running' && (job.total > BIG_GUIDE || Date.now() - job.startedAt > 45_000)
        ? 'Taking a while? Close this window and keep working — the result is applied when it finishes, even if you open another guide.'
        : '';
  }

  function follow(job) {
    showProgress(job);
    const ticker = setInterval(() => job.status === 'running' && showProgress(job), 1000);
    const off = onJobChange((j) => {
      if (j.guideId !== guide.id) return;
      if (j.status === 'running') return showProgress(j);
      clearInterval(ticker);
      off();
      if (j.status === 'failed') {
        // Nothing came back: say why and allow another go.
        $('.choose').hidden = false;
        $('.progress').hidden = true;
        $('.go').hidden = false;
        $('.go').textContent = 'Try again';
        $('[data-act="stop"]').hidden = true;
        $('[data-act="close"]').textContent = 'Close';
        const err = h('<p class="error-text"></p>');
        err.textContent = cleanError(j.errors[0] || 'The AI provider returned nothing.').replace(/^Steps? [\d–]+: /, '');
        dlg.querySelector('.error-text')?.remove();
        $('.choose').append(err);
      } else if (dlg.open) {
        dlg.close();
      }
    });
    unsubscribe = () => {
      clearInterval(ticker);
      off();
    };
  }

  function start() {
    const chosen = f.style.value;
    desktop.settings.update({ ai: { style: chosen } }).catch(() => {});
    if (!f.steps.checked && !f.summary.checked) return toast('Choose at least one thing to improve', { error: true });
    dlg.querySelector('.error-text')?.remove();
    const job = startJob(guide, { provider: s.ai.provider, style: chosen, steps: f.steps.checked, summary: f.summary.checked });
    follow(job);
  }

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    start();
  });
  $('[data-act="close"]').addEventListener('click', () => {
    const job = getJob(guide.id);
    if (job?.status === 'running') toast(`AI keeps working on “${job.title}” in the background`);
    dlg.close();
  });
  $('[data-act="stop"]').addEventListener('click', () => {
    cancelJob(guide.id);
    toast('Stopped. Nothing was changed.');
    dlg.close();
  });
  dlg.addEventListener('close', () => {
    unsubscribe();
    dlg.remove();
  });
  document.body.append(dlg);
  dlg.showModal();

  const existing = getJob(guide.id);
  if (existing?.status === 'running') follow(existing);
  else if (auto) start();
}
