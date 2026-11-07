// FlowDoc content script: watches clicks, typing, selects and key presses
// while a recording is active, describes each one as a human-readable step and
// hands it to the background worker, which takes the screenshot.
(() => {
  if (window.__flowdocLoaded) return;
  window.__flowdocLoaded = true;

  let state = { active: false, paused: false, stepCount: 0 };
  let widget = null;

  // ---------- messaging ----------

  function send(message) {
    try {
      if (!chrome.runtime?.id) return Promise.resolve(null); // extension was reloaded
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  const recording = () => state.active && !state.paused;

  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Step messages leave in the order they were made: a double-click's second
  // press (no screenshot) must not overtake the first press, which waits a
  // frame for the widget to hide. Only the sending is ordered, not the replies.
  let sendTurn = Promise.resolve();
  async function postSteps(message, { hide }) {
    let reply;
    const turn = sendTurn.then(async () => {
      // Hide the widget so it doesn't end up in the screenshot.
      if (hide && widget) {
        widget.host.style.visibility = 'hidden';
        await nextFrame();
      }
      reply = send({ type: 'steps', ...message });
    });
    sendTurn = turn.catch(() => {});
    await turn;
    const res = await reply;
    if (widget) widget.host.style.visibility = '';
    if (res && !res.error) applyState(res);
    return res;
  }

  // ---------- password fields ----------
  // A password must never be readable in a guide: not in the step text, and
  // not in a screenshot. A field counts as a password field if it is one, was
  // one earlier ("Show password" turns it into a plain text field), or is
  // labelled as one. Every screenshot has these fields pixelated out
  // (background.js), so even their dots don't show how long the password is.
  const SECRET_NAME =
    /pass(?:word|wd|code|phrase)|pwd|pin|kennwort|passwort|mot de passe|contrase(?:ñ|n)a|senha|wachtwoord|пароль|密码|密碼|パスワード|비밀번호|पासवर्ड|கடவுச்சொல்|పాస్‌?వర్డ్|ಪಾಸ್‌?ವರ್ಡ್|പാസ്‌?വേഡ്|পাসওয়ার্ড|પાસવર્ડ|ਪਾਸਵਰਡ|كلمة (?:السر|المرور)|סיסמה|şifre|hasło|heslo|jelszó|parola|lösenord|adgangskode|passord|salasana/i;
  const TEXT_TYPES = new Set(['text', 'password', 'tel', 'number', 'search', '']);
  const wasPassword = new WeakSet();

  function isSecretField(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === 'password') {
      wasPassword.add(el);
      return true;
    }
    if (wasPassword.has(el)) return true;
    const auto = String(el.autocomplete || '').toLowerCase();
    if (/(current|new)-password|one-time-code/.test(auto)) return true;
    if (!TEXT_TYPES.has(el.type)) return false;
    return SECRET_NAME.test([labelOf(el), el.name, el.id, el.placeholder, el.getAttribute('aria-label')].filter(Boolean).join(' '));
  }

  // Remembered as soon as one is used, in case it is switched to plain text later.
  const notePassword = (e) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'password') wasPassword.add(e.target);
  };
  document.addEventListener('focusin', notePassword, true);
  document.addEventListener('pointerdown', notePassword, true);

  // Boxes (viewport CSS pixels) of the password fields on screen now.
  function secretRects() {
    const out = [];
    for (const el of document.querySelectorAll('input')) {
      if (out.length >= 20 || !isSecretField(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      out.push({ x: r.left - 3, y: r.top - 3, w: r.width + 6, h: r.height + 6 });
    }
    return out;
  }

  // `settle`: a held repeated click to decide first (see "repeated clicks").
  async function sendSteps(steps, { capture = true, settle = null } = {}) {
    steps = steps.filter(Boolean);
    if (!steps.length || !recording()) return;
    const page = {
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      secrets: capture ? secretRects() : [],
    };
    return postSteps({ steps, page, capture, ...(settle ? { settle } : {}) }, { hide: capture });
  }

  // ---------- describing elements ----------

  const INTERACTIVE =
    'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"], [role="combobox"], [role="treeitem"], [contenteditable=""], [contenteditable="true"], [onclick], [tabindex]:not([tabindex="-1"])';

  const clean = (text, max = 60) => {
    const t = (text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
  };

  function closestComposed(el, selector) {
    while (el) {
      if (el.nodeType === 1 && el.matches(selector)) return el;
      el = el.parentElement || el.getRootNode()?.host || null;
    }
    return null;
  }

  function resolveTarget(event) {
    const path = event.composedPath();
    const deepest = path.find((n) => n.nodeType === 1) || event.target;
    const interactive = closestComposed(deepest, INTERACTIVE);
    // Ignore huge containers that only happen to carry a tabindex/onclick.
    if (interactive && interactive !== document.body) {
      const r = interactive.getBoundingClientRect();
      if (r.width * r.height < window.innerWidth * window.innerHeight * 0.6) return interactive;
    }
    return deepest;
  }

  function textById(ids) {
    return (ids || '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText || '')
      .join(' ');
  }

  function fieldLabel(el) {
    if (el.labels?.length) return clean([...el.labels].map((l) => l.innerText).join(' '));
    const wrapping = el.closest?.('label');
    if (wrapping) return clean(wrapping.innerText);
    return '';
  }

  function labelOf(el) {
    const candidates = [
      el.getAttribute?.('aria-label'),
      textById(el.getAttribute?.('aria-labelledby')),
      ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) ? fieldLabel(el) : '',
      el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type) ? el.value : '',
      el.innerText,
      el.getAttribute?.('placeholder'),
      el.getAttribute?.('alt'),
      el.querySelector?.('img[alt]')?.getAttribute('alt'),
      el.getAttribute?.('title'),
      el.querySelector?.('svg title')?.textContent,
      el.getAttribute?.('name'),
    ];
    for (const c of candidates) {
      const t = clean(c);
      if (t) return t;
    }
    return '';
  }

  function isTextField(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    return !['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].includes(el.type);
  }

  function rectOf(el) {
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }

  function describeClick(el) {
    const label = labelOf(el);
    const role = el.getAttribute('role');
    const tag = el.tagName;
    const b = (t) => `**${t}**`;
    if (tag === 'INPUT' && el.type === 'checkbox') {
      // pointerdown fires before the toggle, so the new state is the opposite.
      return `${el.checked ? 'Uncheck' : 'Check'} ${label ? b(label) : 'the checkbox'}`;
    }
    if ((tag === 'INPUT' && el.type === 'radio') || role === 'radio' || role === 'option') {
      return `Select ${label ? b(label) : 'this option'}`;
    }
    if (role === 'checkbox' || role === 'switch') {
      const on = el.getAttribute('aria-checked') === 'true';
      return `${on ? 'Turn off' : 'Turn on'} ${label ? b(label) : 'the toggle'}`;
    }
    if (isTextField(el)) return `Click the ${label ? b(label) : 'text'} field`;
    if (tag === 'INPUT' && el.type === 'file') return `Click ${label ? b(label) : 'the file picker'} to choose a file`;
    if (role === 'tab') return `Open the ${label ? b(label) : ''} tab`.replace('  ', ' ');
    if (label) return `Click ${b(label)}`;
    if (tag === 'IMG' || el.closest('svg')) return 'Click this icon';
    return 'Click here';
  }

  function baseStep(el, extra = {}) {
    return {
      label: labelOf(el),
      tag: el.tagName.toLowerCase(),
      target: rectOf(el),
      ...extra,
    };
  }

  // ---------- typing drafts ----------
  // Typing becomes one "Type ..." step per field. It is captured after a short
  // pause and refined in place (same id) if the user keeps typing.

  let draft = null; // { el, id, timer, sentValue }

  const fieldValue = (el) => (el.isContentEditable ? el.innerText : el.value) || '';

  function typeStep(d) {
    const el = d.el;
    const label = labelOf(el);
    const value = fieldValue(el);
    const isSecret = isSecretField(el);
    const field = label ? `the **${label}** field` : 'the field';
    const text = isSecret
      ? `Type your password in ${field}`
      : value.length > 120
        ? `Type your text in ${field}`
        : `Type "${clean(value, 120)}" in ${field}`;
    return baseStep(el, { id: d.id, action: 'type', text, value: isSecret ? '' : value, secret: isSecret });
  }

  function takeDraft() {
    if (!draft) return null;
    clearTimeout(draft.timer);
    const value = fieldValue(draft.el);
    if (value === draft.sentValue) return null;
    draft.sentValue = value;
    return typeStep(draft);
  }

  function onInput(event) {
    if (!recording() || !event.isTrusted) return;
    const el = event.composedPath()[0];
    if (!isTextField(el)) return;
    if (held) settleNow();
    run = null;
    if (!draft || draft.el !== el) {
      const pending = takeDraft();
      if (pending) sendSteps([pending]);
      draft = { el, id: crypto.randomUUID(), sentValue: null, timer: 0 };
    }
    clearTimeout(draft.timer);
    draft.timer = setTimeout(() => sendSteps([takeDraft()]), 1200);
  }

  // ---------- repeated clicks ----------
  // A click on the same element as the click before it (someone clicking again
  // while a page is slow, or unsure it worked) goes to the background `hold`:
  // screenshot taken, not yet a step. It is settled at the next action, or
  // 1.5 s later: dropped when nothing changed between the two clicks, or when
  // this click itself changed nothing (no DOM change, same address, checked
  // state, value and focus), and the screenshots agree. Clicks and
  // double-clicks are each compared with their own kind.

  let run = null; // the last click: { el, id, kind, snapshot, changed, ids }
  let held = null; // the click being held: { ...run fields, prev, idleBefore, timer }
  const observer = new MutationObserver((records) => {
    if (run && records.some((r) => r.target !== widget?.host)) run.changed = true;
  });
  function watchPage(on) {
    if (on) {
      secretRects(); // note the password fields now, before any can be switched to plain text
      observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    } else observer.disconnect();
    run = null;
    if (held) clearTimeout(held.timer);
    held = null;
  }
  const snapshotOf = (el) => ({ url: location.href, checked: el.checked, value: el.value, active: document.activeElement });
  // Whether nothing on the page changed since the click `rec`.
  function unchangedSince(rec) {
    if (!rec || rec.changed) return false;
    const el = rec.el;
    const a = rec.snapshot;
    const b = snapshotOf(el);
    // A click may focus the element itself; that isn't a change.
    const focusSame = a.active === b.active || b.active === el || el.contains?.(b.active);
    return a.url === b.url && a.checked === b.checked && a.value === b.value && focusSame;
  }
  // What the background needs to decide the held click; `gone` when the page is going away.
  function takeSettle({ gone = false } = {}) {
    const h = held;
    if (!h) return null;
    held = null;
    clearTimeout(h.timer);
    return { id: h.id, prevIds: h.ids, sameKind: h.kind === h.prev.kind, idleBefore: h.idleBefore, idleAfter: !gone && unchangedSince(h) };
  }
  // Settles the held click on its own, with a screenshot taken now.
  async function settleNow(opts) {
    const settle = takeSettle(opts);
    if (!settle || !recording()) return;
    if (opts?.gone) return send({ type: 'steps', steps: [], settle, capture: false }); // no frame to wait for
    await postSteps({ steps: [], settle, capture: true }, { hide: true });
  }
  function holdTimer(h) {
    clearTimeout(h.timer);
    h.timer = setTimeout(() => held === h && settleNow(), 1500);
  }

  // ---------- clicks, keys, selects ----------

  let lastClick = null; // { el, at, id, label }

  function onPointerDown(event) {
    if (!recording() || !event.isTrusted || event.button !== 0) return;
    if (widget && event.composedPath().includes(widget.host)) return;
    const el = resolveTarget(event);
    if (!el || el === document.documentElement) return;
    if (el.tagName === 'SELECT') return; // recorded on change instead
    if (el.tagName === 'OPTION') return;

    // A second press on the same element right away is a double-click.
    if (lastClick && lastClick.el === el && Date.now() - lastClick.at < 450) {
      const label = labelOf(el);
      sendSteps([{ id: lastClick.id, action: 'dblclick', relabel: true, text: label ? `Double-click **${label}**` : 'Double-click here' }], {
        capture: false,
      });
      if (run?.id === lastClick.id) run.kind = 'dblclick';
      if (held?.id === lastClick.id) holdTimer(held); // judged as a double-click, from now
      lastClick = null;
      return;
    }

    const pending = takeDraft();
    if (draft && draft.el !== el) draft = null;
    // Clicking a field you're already typing in isn't a new step.
    if (!pending && isTextField(el) && el === document.activeElement) return;

    const settle = takeSettle(); // this click's screenshot shows what a held click did
    const id = crypto.randomUUID();
    lastClick = { el, at: Date.now(), id };
    // A label wrapping a checkbox reads better as the checkbox itself.
    const subject = el.tagName === 'LABEL' && el.control ? el.control : el;
    const prev = run;
    const again = !pending && prev?.el === subject;
    const rec = { el: subject, id, kind: 'click', snapshot: snapshotOf(subject), changed: false, ids: again ? [...prev.ids, prev.id] : [] };
    if (again) {
      Object.assign(rec, { prev, idleBefore: unchangedSince(prev) });
      held = rec;
      holdTimer(rec);
    }
    run = rec;
    sendSteps(
      [
        pending,
        baseStep(el, {
          id,
          action: 'click',
          text: describeClick(subject),
          click: { x: event.clientX, y: event.clientY },
          ...(again ? { hold: true } : {}),
        }),
      ],
      { settle },
    );
  }

  function onKeyDown(event) {
    if (!recording() || !event.isTrusted) return;
    const el = event.composedPath()[0];
    const keyName = { Enter: 'Enter', Escape: 'Esc', Tab: 'Tab' }[event.key];
    if (!keyName) return;
    if (keyName === 'Enter' && el?.tagName === 'TEXTAREA' && !event.ctrlKey && !event.metaKey) return;
    if (keyName === 'Enter' && el?.isContentEditable && !event.ctrlKey && !event.metaKey) return;
    if (keyName === 'Tab') {
      // Tab only moves focus; just make sure pending typing is saved.
      const pending = takeDraft();
      if (pending) sendSteps([pending]);
      draft = null;
      return;
    }
    const pending = takeDraft();
    draft = null;
    const settle = takeSettle();
    run = null;
    const target = el?.nodeType === 1 ? el : document.activeElement || document.body;
    sendSteps([pending, baseStep(target, { action: 'key', key: event.key, text: `Press **${keyName}**` })], { settle });
  }

  function onChange(event) {
    if (!recording() || !event.isTrusted) return;
    const el = event.composedPath()[0];
    if (el?.tagName !== 'SELECT') return;
    const settle = takeSettle();
    run = null;
    const chosen = clean([...el.selectedOptions].map((o) => o.text).join(', '));
    const label = labelOf(el);
    sendSteps(
      [
        baseStep(el, {
          action: 'select',
          value: chosen,
          label,
          text: `Select **${chosen || 'an option'}**${label ? ` from **${label}**` : ''}`,
        }),
      ],
      { settle },
    );
  }

  function onFocusOut(event) {
    if (!draft || event.composedPath()[0] !== draft.el) return;
    const pending = takeDraft();
    if (pending) sendSteps([pending]);
  }

  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('input', onInput, true);
  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('change', onChange, true);
  window.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('pagehide', () => {
    settleNow({ gone: true }); // leaving the page: the held click did something
    const pending = takeDraft();
    if (pending) sendSteps([pending], { capture: false });
  });

  // ---------- recording widget ----------

  const WIDGET_CSS = `
    :host { all: initial; }
    .bar { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; display: flex; align-items: center; gap: 4px;
      padding: 6px 6px 6px 12px; border-radius: 999px; background: #0f172a; color: #f8fafc;
      font: 500 13px/1 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 8px 30px rgba(15,23,42,.35);
      user-select: none; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #f43f5e; margin-right: 6px; animation: pulse 1.4s infinite; }
    .paused .dot { background: #94a3b8; animation: none; }
    .label { margin-right: 6px; white-space: nowrap; }
    .count { color: #94a3b8; font-variant-numeric: tabular-nums; margin-right: 6px; }
    button { all: unset; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border-radius: 999px;
      color: #e2e8f0; font: inherit; }
    button:hover { background: rgba(255,255,255,.1); }
    button:focus-visible { outline: 2px solid #818cf8; }
    .done { background: #4f46e5; color: #fff; }
    .done:hover { background: #4338ca; }
    svg { width: 15px; height: 15px; }
    @keyframes pulse { 50% { opacity: .35; } }
  `;
  const ICONS = {
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  function mountWidget() {
    if (widget) return;
    const host = document.createElement('flowdoc-recorder');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${WIDGET_CSS}</style>
      <div class="bar" role="toolbar" aria-label="FlowDoc recorder">
        <span class="dot"></span><span class="label"></span><span class="count"></span>
        <button class="toggle" title="Pause capture"></button>
        <button class="discard" title="Discard this recording">${ICONS.trash}</button>
        <button class="done" title="Stop and build the guide">${ICONS.check}<span>Done</span></button>
      </div>`;
    const $ = (s) => root.querySelector(s);
    // A click still being held is decided before pausing or stopping.
    $('.toggle').addEventListener('click', async () => {
      if (!state.paused) await settleNow();
      send({ type: state.paused ? 'resume' : 'pause' }).then(applyState);
    });
    $('.done').addEventListener('click', async () => {
      await settleNow();
      send({ type: 'stop' }).then(applyState);
    });
    $('.discard').addEventListener('click', () => {
      if (confirm('Discard this recording? The captured steps will be deleted.')) send({ type: 'discard' }).then(applyState);
    });
    document.documentElement.appendChild(host);
    widget = { host, root, $ };
  }

  function renderWidget() {
    if (!widget) return;
    const { $ } = widget;
    $('.bar').classList.toggle('paused', state.paused);
    $('.label').textContent = state.paused ? 'Paused' : 'Capturing';
    $('.count').textContent = `${state.stepCount || 0} step${state.stepCount === 1 ? '' : 's'}`;
    $('.toggle').innerHTML = state.paused ? ICONS.play : ICONS.pause;
    $('.toggle').title = state.paused ? 'Resume capture' : 'Pause capture';
  }

  function applyState(next) {
    if (!next || next.error || typeof next.active !== 'boolean') return;
    const wasRecording = recording();
    state = next;
    if (recording() !== wasRecording) watchPage(recording());
    if (state.active) {
      mountWidget();
      renderWidget();
    } else if (widget) {
      widget.host.remove();
      widget = null;
      draft = null;
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'state') applyState(msg.state);
  });

  send({ type: 'getState' }).then(applyState);
})();
