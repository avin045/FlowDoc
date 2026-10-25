// Screenshot editor: redact (pixelate) regions, crop, and toggle the click
// highlight. Edits are stored as fractions of the original frame, so they stay
// non-destructive and can be undone or reset at any time.
import { renderStepCanvas } from './render.js';

export function openImageEditor(step, { onSave }) {
  const draft = {
    ...step,
    redactions: [...(step.redactions || [])],
    crop: step.crop ? { ...step.crop } : null,
    highlight: step.highlight !== false,
  };
  let tool = 'redact';
  const history = [];

  const dialog = document.createElement('dialog');
  dialog.className = 'image-editor';
  dialog.innerHTML = `
    <div class="ie-toolbar">
      <div class="seg" role="group" aria-label="Tool">
        <button data-tool="redact" class="on" title="Drag over sensitive information to blur it">Redact</button>
        <button data-tool="crop" title="Drag to choose the visible area">Crop</button>
      </div>
      <label class="check"><input type="checkbox" class="hl"> Click highlight</label>
      <span class="spacer"></span>
      <button class="ghost undo" title="Undo (Ctrl+Z)">Undo</button>
      <button class="ghost reset-crop">Remove crop</button>
      <button class="ghost clear-redact">Clear redactions</button>
    </div>
    <div class="ie-stage"><div class="ie-frame"><canvas></canvas><div class="ie-overlay"></div></div></div>
    <div class="ie-footer">
      <span class="ie-hint"></span>
      <span class="spacer"></span>
      <button class="secondary cancel">Cancel</button>
      <button class="primary save">Save changes</button>
    </div>`;
  document.body.append(dialog);
  const $ = (s) => dialog.querySelector(s);
  const canvas = $('canvas');
  const overlay = $('.ie-overlay');

  const hints = {
    redact: 'Drag across names, emails or numbers to blur them. Click a blurred box to remove it.',
    crop: 'Drag to choose the area to keep. Everything outside is trimmed from the guide.',
  };

  async function paint() {
    const full = await renderStepCanvas({ ...draft, crop: null }, { crop: false });
    canvas.width = full.width;
    canvas.height = full.height;
    canvas.getContext('2d').drawImage(full, 0, 0);
    drawOverlay();
  }

  function rectStyle(el, r) {
    Object.assign(el.style, { left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
  }

  function drawOverlay(live) {
    overlay.replaceChildren();
    draft.redactions.forEach((r, i) => {
      const el = document.createElement('button');
      el.className = 'ie-redaction';
      el.title = 'Remove this redaction';
      rectStyle(el, r);
      el.addEventListener('click', (e) => {
        if (tool !== 'redact') return;
        e.stopPropagation();
        commit(() => draft.redactions.splice(i, 1));
      });
      overlay.append(el);
    });
    const crop = live?.tool === 'crop' ? live.rect : draft.crop;
    if (crop) {
      const el = document.createElement('div');
      el.className = 'ie-crop';
      rectStyle(el, crop);
      overlay.append(el);
    }
    if (live?.tool === 'redact') {
      const el = document.createElement('div');
      el.className = 'ie-draft';
      rectStyle(el, live.rect);
      overlay.append(el);
    }
  }

  function commit(change) {
    history.push({ redactions: [...draft.redactions], crop: draft.crop && { ...draft.crop }, highlight: draft.highlight });
    change();
    paint();
  }

  function undo() {
    const prev = history.pop();
    if (!prev) return;
    Object.assign(draft, prev);
    $('.hl').checked = draft.highlight;
    paint();
  }

  function setTool(t) {
    tool = t;
    dialog.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    overlay.dataset.tool = t;
    $('.ie-hint').textContent = hints[t];
  }

  // drag to draw a rectangle
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target !== overlay && !e.target.classList.contains('ie-crop')) return;
    const box = overlay.getBoundingClientRect();
    const clamp = (v) => Math.min(1, Math.max(0, v));
    const at = (ev) => ({ x: clamp((ev.clientX - box.left) / box.width), y: clamp((ev.clientY - box.top) / box.height) });
    const start = at(e);
    let rect = null;
    overlay.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const p = at(ev);
      rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      drawOverlay({ tool, rect });
    };
    const up = () => {
      overlay.removeEventListener('pointermove', move);
      overlay.removeEventListener('pointerup', up);
      if (!rect || rect.w < 0.01 || rect.h < 0.01) {
        drawOverlay();
        return;
      }
      if (tool === 'redact') commit(() => draft.redactions.push(rect));
      else commit(() => (draft.crop = rect));
    };
    overlay.addEventListener('pointermove', move);
    overlay.addEventListener('pointerup', up);
  });

  dialog.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
  $('.hl').checked = draft.highlight;
  $('.hl').addEventListener('change', (e) => commit(() => (draft.highlight = e.target.checked)));
  $('.undo').addEventListener('click', undo);
  $('.reset-crop').addEventListener('click', () => draft.crop && commit(() => (draft.crop = null)));
  $('.clear-redact').addEventListener('click', () => draft.redactions.length && commit(() => (draft.redactions = [])));
  $('.cancel').addEventListener('click', () => dialog.close());
  $('.save').addEventListener('click', () => {
    onSave({ redactions: draft.redactions, crop: draft.crop, highlight: draft.highlight });
    dialog.close();
  });
  dialog.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });
  dialog.addEventListener('close', () => dialog.remove());

  setTool('redact');
  paint();
  dialog.showModal();
}
