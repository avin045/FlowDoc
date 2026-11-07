// Shared rendering helpers: rich step text, screenshot compositing (highlight,
// redaction, crop) and the export model every exporter consumes.

export const HIGHLIGHT_COLOR = '#f43f5e';

// How clicks are marked on screenshots, chosen in Settings:
//   normal: outline around the clicked element + ring at the click point
//   box:    outline only
//   none:   no marks
// A display preference, so it lives in this browser profile like the theme.
export const HIGHLIGHT_STYLES = ['normal', 'box', 'none'];
const STYLE_KEY = 'flowdoc.highlightStyle';

export function getHighlightStyle() {
  try {
    const v = localStorage.getItem(STYLE_KEY);
    return HIGHLIGHT_STYLES.includes(v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function setHighlightStyle(style) {
  const v = HIGHLIGHT_STYLES.includes(style) ? style : 'normal';
  try {
    localStorage.setItem(STYLE_KEY, v);
  } catch {}
  window.dispatchEvent(new CustomEvent('flowdoc:highlight-style', { detail: v }));
}

// ---------- text ----------

// A step's link, if it is one that may be shown and opened: web pages and
// local files only (never javascript: or data: links, whatever a guide holds).
export function safeLink(url) {
  const u = String(url ?? '').trim();
  return /^(https?|file):/i.test(u) ? u : '';
}

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
  p.catch(() => imageCache.delete(src));
  // Each entry holds a decoded screenshot; keep a few dozen, not a library's worth.
  if (imageCache.size > 48) imageCache.delete(imageCache.keys().next().value);
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

function drawHighlight(ctx, step, scale, style) {
  if (style === 'none') return;
  const color = HIGHLIGHT_COLOR;
  const t = step.target;
  if (t && t.w > 0 && t.h > 0) {
    const pad = 4 * scale;
    ctx.save();
    // Outline only: no tint over the element, so its label stays crisp.
    ctx.lineWidth = 3 * scale;
    ctx.strokeStyle = color;
    roundRect(ctx, t.x * scale - pad, t.y * scale - pad, t.w * scale + pad * 2, t.h * scale + pad * 2, 6 * scale);
    ctx.stroke();
    ctx.restore();
  }
  if (step.click && style === 'normal') {
    // A hollow ring: marks the spot without covering what was clicked. The
    // white edge keeps it visible on dark windows as well as light pages.
    const cx = step.click.x * scale;
    const cy = step.click.y * scale;
    const r = 15 * scale;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = 5 * scale;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.stroke();
    ctx.lineWidth = 2.5 * scale;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }
}

// Composites a step's screenshot with its edits. Returns a canvas.
// `crop: false` renders the full frame (used by the screenshot editor).
// `highlightStyle` overrides the Settings choice; `forceHighlight` draws the
// marks even on steps where they're hidden (the AI needs them to see what
// was clicked).
export async function renderStepCanvas(step, { crop = true, maxWidth = 0, highlightStyle, forceHighlight = false } = {}) {
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
  if ((step.highlight !== false || forceHighlight) && step.kind === 'action') {
    drawHighlight(ctx, step, scale, highlightStyle || getHighlightStyle());
  }

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
  JSON.stringify([step.screenshot?.length, step.screenshot?.slice(-48), step.highlight, step.redactions, step.crop, step.target, step.click, getHighlightStyle(), opts]);

const RENDER_CACHE_MAX = 40;

// Data URL of the finished screenshot (for exports), cached by its edit state.
// The cache keeps the most recently used ones only.
export async function renderStepImage(step, { maxWidth = 1600, quality = 0.9 } = {}) {
  if (!step.screenshot) return null;
  const key = editKey(step, [maxWidth, quality]);
  const cached = renderCache.get(step.id);
  if (cached?.key === key) {
    renderCache.delete(step.id);
    renderCache.set(step.id, cached);
    return cached.value;
  }
  const canvas = await renderStepCanvas(step, { maxWidth });
  const value = { dataUrl: canvas.toDataURL('image/jpeg', quality), width: canvas.width, height: canvas.height };
  renderCache.delete(step.id);
  renderCache.set(step.id, { key, value });
  while (renderCache.size > RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value);
  return value;
}

// The editor shows screenshots from blob: URLs: the browser keeps them
// compressed and decodes only what is on screen, where a data: URL would sit
// in memory as a long string for every step. One URL per step of the open
// guide; releaseStepImages() frees the others.
const viewUrls = new Map(); // step id -> { key, url, width, height }

export async function stepImageUrl(step, { maxWidth = 1400 } = {}) {
  if (!step.screenshot) return null;
  const key = editKey(step, [maxWidth, 'view']);
  const hit = viewUrls.get(step.id);
  if (hit?.key === key) return hit;
  const canvas = await renderStepCanvas(step, { maxWidth });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) return null;
  const value = { key, url: URL.createObjectURL(blob), width: canvas.width, height: canvas.height };
  const now = viewUrls.get(step.id);
  if (now?.key === key) {
    URL.revokeObjectURL(value.url); // rendered twice at once; keep the first
    return now;
  }
  if (now) URL.revokeObjectURL(now.url); // an image already showing stays on screen
  viewUrls.set(step.id, value);
  return value;
}

// Frees the editor images of every step not in `keep` (a Set of step ids).
export function releaseStepImages(keep = new Set()) {
  for (const [id, v] of viewUrls) {
    if (keep.has(id)) continue;
    URL.revokeObjectURL(v.url);
    viewUrls.delete(id);
  }
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
    const block = { kind: step.kind, text: step.text || '', note: step.note || '', url: safeLink(step.href) };
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
    // Set on translated copies: { code, native, english, rtl? }
    language: guide.language || null,
    rtl: !!guide.language?.rtl,
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
