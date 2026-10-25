// Shared rendering helpers: rich step text, screenshot compositing (highlight,
// redaction, crop) and the export model every exporter consumes.

export const HIGHLIGHT_COLOR = '#f43f5e';

// ---------- text ----------

export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Step text uses a tiny markup: **bold** for the element that was acted on.
export function parseRuns(text) {
  const runs = [];
  const parts = String(text ?? '').split(/(\*\*[^*]+\*\*)/g);
  for (const part of parts) {
    if (!part) continue;
    if (/^\*\*[^*]+\*\*$/.test(part)) runs.push({ text: part.slice(2, -2), bold: true });
    else runs.push({ text: part, bold: false });
  }
  return runs;
}

export const plainText = (text) => parseRuns(text).map((r) => r.text).join('');

export function richToHtml(text) {
  return parseRuns(text)
    .map((r) => (r.bold ? `<b>${escapeHtml(r.text)}</b>` : escapeHtml(r.text)))
    .join('')
    .replace(/\n/g, '<br>');
}

// Converts contenteditable HTML back into the **bold** markup.
export function htmlToRich(root) {
  let out = '';
  const walk = (node, bold) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const t = child.textContent.replace(/\*\*/g, '*');
        out += bold && t.trim() ? `**${t}**` : t;
      } else if (child.nodeName === 'BR') {
        out += '\n';
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const isBold =
          bold || ['B', 'STRONG'].includes(child.nodeName) || Number(child.style?.fontWeight) >= 600;
        if (['DIV', 'P'].includes(child.nodeName) && out && !out.endsWith('\n')) out += '\n';
        walk(child, isBold);
      }
    }
  };
  walk(root, false);
  return out.replace(/\*\*\*\*/g, '').replace(/ /g, ' ').trim();
}

// ---------- images ----------

const imageCache = new Map();

export function loadImage(src) {
  if (imageCache.has(src)) return imageCache.get(src);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load screenshot'));
    img.src = src;
  });
  imageCache.set(src, p);
  if (imageCache.size > 200) imageCache.delete(imageCache.keys().next().value);
  return p;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function pixelate(ctx, source, x, y, w, h, block) {
  x = Math.max(0, Math.round(x));
  y = Math.max(0, Math.round(y));
  w = Math.round(Math.min(w, ctx.canvas.width - x));
  h = Math.round(Math.min(h, ctx.canvas.height - y));
  if (w < 1 || h < 1) return;
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / block));
  small.height = Math.max(1, Math.round(h / block));
  const sctx = small.getContext('2d');
  sctx.drawImage(source, x, y, w, h, 0, 0, small.width, small.height);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
  ctx.restore();
}

function drawHighlight(ctx, step, scale) {
  const color = HIGHLIGHT_COLOR;
  const t = step.target;
  if (t && t.w > 0 && t.h > 0) {
    const pad = 4 * scale;
    ctx.save();
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = color;
    ctx.fillStyle = 'rgba(244, 63, 94, 0.08)';
    roundRect(ctx, t.x * scale - pad, t.y * scale - pad, t.w * scale + pad * 2, t.h * scale + pad * 2, 6 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  if (step.click) {
    const cx = step.click.x * scale;
    const cy = step.click.y * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 16 * scale, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(244, 63, 94, 0.28)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 6 * scale, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }
}

// Composites a step's screenshot with its edits. Returns a canvas.
// `crop: false` renders the full frame (used by the screenshot editor).
export async function renderStepCanvas(step, { crop = true, maxWidth = 0 } = {}) {
  const img = await loadImage(step.screenshot);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const base = document.createElement('canvas');
  base.width = W;
  base.height = H;
  const ctx = base.getContext('2d');
  ctx.drawImage(img, 0, 0);

  const scale = step.shot?.viewportW ? W / step.shot.viewportW : 1;
  for (const r of step.redactions || []) {
    pixelate(ctx, img, r.x * W, r.y * H, r.w * W, r.h * H, Math.max(8, 11 * scale));
  }
  if (step.highlight !== false && step.kind === 'action') drawHighlight(ctx, step, scale);

  let out = base;
  const c = crop && step.crop;
  if (c && c.w > 0.02 && c.h > 0.02) {
    out = document.createElement('canvas');
    out.width = Math.round(c.w * W);
    out.height = Math.round(c.h * H);
    out.getContext('2d').drawImage(base, c.x * W, c.y * H, out.width, out.height, 0, 0, out.width, out.height);
  }
  if (maxWidth && out.width > maxWidth) {
    const scaled = document.createElement('canvas');
    scaled.width = maxWidth;
    scaled.height = Math.round((out.height * maxWidth) / out.width);
    const sctx = scaled.getContext('2d');
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(out, 0, 0, scaled.width, scaled.height);
    out = scaled;
  }
  return out;
}

const renderCache = new Map();
const editKey = (step, opts) =>
  JSON.stringify([step.screenshot?.length, step.screenshot?.slice(-48), step.highlight, step.redactions, step.crop, step.target, step.click, opts]);

// Data URL of the finished screenshot, cached by its edit state.
export async function renderStepImage(step, { maxWidth = 1600, quality = 0.9 } = {}) {
  if (!step.screenshot) return null;
  const key = editKey(step, [maxWidth, quality]);
  const cached = renderCache.get(step.id);
  if (cached?.key === key) return cached.value;
  const canvas = await renderStepCanvas(step, { maxWidth });
  const value = { dataUrl: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height };
  renderCache.set(step.id, { key, value });
  return value;
}

export async function dataUrlToBytes(dataUrl) {
  return new Uint8Array(await (await fetch(dataUrl)).arrayBuffer());
}

// ---------- export model ----------

export const STEP_KINDS = ['action', 'manual'];
export const isNumbered = (step) => STEP_KINDS.includes(step.kind);

// Flattens a guide into what every exporter needs: numbered blocks with
// finished images.
export async function buildExportModel(guide, { images = true, maxWidth = 1600 } = {}) {
  let n = 0;
  const blocks = [];
  for (const step of guide.steps) {
    const block = { kind: step.kind, text: step.text || '', note: step.note || '', url: step.href || '' };
    if (isNumbered(step)) {
      block.number = ++n;
      if (images && step.screenshot && !step.hideImage) block.image = await renderStepImage(step, { maxWidth });
    }
    blocks.push(block);
  }
  return {
    title: guide.title || 'Untitled guide',
    description: guide.description || '',
    stepCount: n,
    createdAt: guide.createdAt,
    author: guide.author || '',
    blocks,
  };
}

export function fileSafe(name) {
  return (name || 'guide').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'guide';
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatDate(ts) {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
