import { buildExportModel, fileSafe, plainText } from '../render.js';
import { exportDocx } from './docx.js';
import { exportHtml, guideToHtml } from './html.js';
import { exportMarkdown } from './markdown.js';
import { exportPdf } from './pdf.js';

export const FORMATS = [
  { id: 'pdf', label: 'PDF', ext: 'pdf', desc: 'Paginated document, ready to print or attach.' },
  { id: 'docx', label: 'Word', ext: 'docx', desc: 'Editable Microsoft Word document (.docx).' },
  { id: 'html', label: 'HTML', ext: 'html', desc: 'Single self-contained web page with images embedded.' },
  { id: 'markdown', label: 'Markdown', ext: 'zip', desc: 'guide.md plus an images folder, for wikis and Git repos.' },
  { id: 'json', label: 'Backup', ext: 'json', desc: 'Full copy you can import into FlowDoc again.' },
];

export async function exportGuide(guide, format, options = {}) {
  const base = fileSafe(guide.title);
  if (format === 'json') {
    const data = { format: 'flowdoc-guide', version: 1, guide };
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
  const url = URL.createObjectURL(new Blob([guideToHtml(model, { autoPrint: true })], { type: 'text/html' }));
  window.open(url, '_blank');
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

export function parseImport(text) {
  const data = JSON.parse(text);
  // 'stepcraft-guide' is the backup format from before the FlowDoc rename.
  const guide = data?.format === 'flowdoc-guide' || data?.format === 'stepcraft-guide' ? data.guide : data;
  if (!guide || !Array.isArray(guide.steps)) throw new Error('This file is not a FlowDoc guide.');
  return guide;
}
