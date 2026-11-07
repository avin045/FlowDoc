import { buildExportModel, fileSafe, plainText } from '../render.js';
import { exportDocx } from './docx.js';
import { exportHtml, guideToHtml } from './html.js';
import { exportMarkdown, guideToMarkdown } from './markdown.js';
import { exportPdf } from './pdf.js';

export const FORMATS = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', desc: 'Paginated document, ready to print or attach.' },
  { id: 'docx', label: 'Word', ext: 'docx', desc: 'Editable Microsoft Word document (.docx).' },
  { id: 'html', label: 'HTML', ext: 'html', desc: 'Single self-contained web page with images embedded.' },
  { id: 'markdown', label: 'Markdown', ext: 'zip', desc: 'guide.md plus an images folder, for wikis and Git repos.' },
  { id: 'json', label: 'Backup', ext: 'json', desc: 'Full copy you can import into FlowDoc again.' },
];

// The desktop app keeps screenshots as files next to the guide; a backup must
// carry the images themselves.
async function inlineImages(guide) {
  const copy = structuredClone(guide);
  delete copy.thumb;
  delete copy.thumbKey;
  await Promise.all(
    copy.steps.map(async (s) => {
      if (typeof s.screenshot !== 'string' || s.screenshot.startsWith('data:')) return;
      const blob = await (await fetch(s.screenshot)).blob();
      s.screenshot = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }),
  );
  return copy;
}

export async function exportGuide(guide, format, options = {}) {
  const base = fileSafe(guide.title);
  if (format === 'json') {
    const data = { format: 'flowdoc-guide', version: 1, guide: await inlineImages(guide) };
    return { blob: new Blob([JSON.stringify(data)], { type: 'application/json' }), filename: `${base}.flowdoc.json` };
  }
  const model = await buildExportModel(guide, { images: options.images !== false });
  switch (format) {
    case 'html':
      return { blob: exportHtml(model), filename: `${base}.html` };
    case 'pdf':
      return { blob: await exportPdf(model, options), filename: `${base}.pdf` };
    case 'docx':
      return { blob: await exportDocx(model, options), filename: `${base}.docx` };
    case 'markdown': {
      const { blob, ext } = await exportMarkdown(model, { embed: options.embedImages });
      return { blob, filename: `${base}.${ext}` };
    }
    default:
      throw new Error(`Unknown export format: ${format}`);
  }
}

// Opens the HTML version in a new tab and triggers the browser's print dialog
// ("Save as PDF" there handles every script and font).
export async function printGuide(guide) {
  const model = await buildExportModel(guide);
  const url = URL.createObjectURL(new Blob([guideToHtml(model)], { type: 'text/html' }));
  // Printed from here: the page's security policy (and the extension's) keeps
  // scripts out of the preview itself.
  const w = window.open(url, '_blank');
  w?.addEventListener('load', () => setTimeout(() => w.print(), 300));
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export function guideToPlainText(guide) {
  let n = 0;
  const lines = [guide.title || 'Untitled guide', ''];
  if (guide.description) lines.push(guide.description, '');
  for (const s of guide.steps) {
    if (s.kind === 'action' || s.kind === 'manual') lines.push(`${++n}. ${plainText(s.text)}${s.note ? ` — ${plainText(s.note)}` : ''}`);
    else if (s.kind === 'heading') lines.push('', s.text.toUpperCase());
    else if (s.kind === 'tip') lines.push(`   Tip: ${plainText(s.text)}`);
    else if (s.kind === 'alert') lines.push(`   Important: ${plainText(s.text)}`);
    else lines.push(plainText(s.text));
  }
  return lines.join('\n');
}

// Markdown for the clipboard. With `images`, the screenshots are embedded in
// the text, so one paste brings them along.
export async function guideToClipboardMarkdown(guide, { images }) {
  const model = await buildExportModel(guide, { images });
  return guideToMarkdown(model, { imagePath: (b) => b.image.dataUrl });
}

// An imported file comes from anyone, so only what FlowDoc itself would have
// written is kept: ids and kinds end up in the page's HTML, and screenshots
// and links are loaded or opened.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = new Set(['action', 'manual', 'tip', 'alert', 'heading', 'text']);
const SAFE_LINK = /^(https?|file):/i;
const SAFE_IMAGE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function parseImport(text) {
  const data = JSON.parse(text);
  // 'stepcraft-guide' is the backup format from before the FlowDoc rename.
  const guide = data?.format === 'flowdoc-guide' || data?.format === 'stepcraft-guide' ? data.guide : data;
  if (!guide || typeof guide !== 'object' || !Array.isArray(guide.steps)) throw new Error('This file is not a FlowDoc guide.');
  guide.title = str(guide.title);
  guide.description = str(guide.description);
  delete guide.thumb; // made again from the first screenshot
  delete guide.thumbKey;
  const ids = new Set();
  guide.steps = guide.steps
    .filter((s) => s && typeof s === 'object' && !Array.isArray(s))
    .map((s) => {
      if (!SAFE_ID.test(str(s.id)) || ids.has(s.id)) delete s.id; // the caller gives it a new one
      else ids.add(s.id);
      if (!KINDS.has(s.kind)) s.kind = 'manual';
      s.text = str(s.text);
      if (s.note != null) s.note = str(s.note);
      for (const k of ['href', 'url']) if (s[k] != null && !SAFE_LINK.test(str(s[k]))) delete s[k];
      if (s.screenshot != null && !SAFE_IMAGE.test(str(s.screenshot))) {
        delete s.screenshot;
        delete s.shot;
      }
      return s;
    });
  return guide;
}
