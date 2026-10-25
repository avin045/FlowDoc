import { formatDate } from '../render.js';

// Markdown keeps the **bold** markup as-is; only stray markdown characters in
// plain prose need escaping.
const escapeMd = (text) => String(text ?? '').replace(/([\\`_[\]<>#])/g, '\\$1');
const md = (text) => escapeMd(text).replace(/\n/g, '  \n');

export function guideToMarkdown(model, { imagePath }) {
  const lines = [`# ${escapeMd(model.title)}`, ''];
  if (model.description) lines.push(md(model.description), '');
  lines.push(`*${model.stepCount} steps · ${formatDate(model.createdAt)}*`, '');
  for (const b of model.blocks) {
    if (b.kind === 'heading') lines.push(`## ${escapeMd(b.text)}`, '');
    else if (b.kind === 'tip') lines.push(`> **Tip:** ${md(b.text).replace(/\n/g, '\n> ')}`, '');
    else if (b.kind === 'alert') lines.push(`> **⚠ Important:** ${md(b.text).replace(/\n/g, '\n> ')}`, '');
    else if (b.kind === 'text') lines.push(md(b.text), '');
    else {
      lines.push(`### ${b.number}. ${md(b.text)}`, '');
      if (b.note) lines.push(md(b.note), '');
      if (b.url) lines.push(`<${b.url}>`, '');
      if (b.image) lines.push(`![Step ${b.number}](${imagePath(b)})`, '');
    }
  }
  lines.push('---', '*Made with FlowDoc*', '');
  return lines.join('\n');
}

// Default: a .zip with guide.md and an images/ folder. `embed` produces a
// single .md with the screenshots inlined as data URIs.
export async function exportMarkdown(model, { embed = false } = {}) {
  if (embed) {
    const text = guideToMarkdown(model, { imagePath: (b) => b.image.dataUrl });
    return { blob: new Blob([text], { type: 'text/markdown;charset=utf-8' }), ext: 'md' };
  }
  const zip = new window.JSZip();
  const name = (b) => `images/step-${String(b.number).padStart(2, '0')}.jpg`;
  zip.file('guide.md', guideToMarkdown(model, { imagePath: name }));
  for (const b of model.blocks) {
    if (b.image) zip.file(name(b), b.image.dataUrl.split(',')[1], { base64: true });
  }
  return { blob: await zip.generateAsync({ type: 'blob' }), ext: 'zip' };
}
