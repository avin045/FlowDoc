import { escapeHtml, formatDate, richToHtml } from '../render.js';

const CSS = `
  :root { --fg:#0f172a; --muted:#64748b; --line:#e2e8f0; --accent:#4f46e5; --tip:#eef2ff; --tip-line:#6366f1; --alert:#fff7ed; --alert-line:#f97316; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f8fafc; color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 48px 24px 64px; background: #fff; min-height: 100vh; }
  h1 { font-size: 32px; line-height: 1.2; margin: 0 0 12px; letter-spacing: -.01em; }
  .desc { color: #334155; margin: 0 0 12px; white-space: pre-wrap; }
  .meta { color: var(--muted); font-size: 14px; margin: 0 0 32px; padding-bottom: 24px; border-bottom: 1px solid var(--line); }
  .step { display: grid; grid-template-columns: 36px 1fr; gap: 16px; margin: 0 0 36px; }
  .num { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; font-weight: 700; font-size: 15px;
    display: flex; align-items: center; justify-content: center; }
  .text { margin: 3px 0 6px; font-size: 17px; }
  .note { margin: 0 0 8px; color: #475569; white-space: pre-wrap; }
  .url { display: inline-block; margin: 0 0 10px; color: var(--accent); font-size: 14px; word-break: break-all; }
  figure { margin: 8px 0 0; }
  img { display: block; max-width: 100%; height: auto; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 2px 10px rgba(15,23,42,.06); }
  h2 { font-size: 22px; margin: 44px 0 20px; }
  .callout { margin: 0 0 32px 52px; padding: 12px 16px; border-radius: 8px; border-left: 4px solid var(--tip-line); background: var(--tip); white-space: pre-wrap; }
  .callout.alert { border-color: var(--alert-line); background: var(--alert); }
  .callout strong { display: block; font-size: 13px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 2px; }
  .textblock { margin: 0 0 28px 52px; white-space: pre-wrap; }
  footer { margin-top: 48px; color: var(--muted); font-size: 13px; text-align: center; }
  @media (max-width: 600px) { main { padding: 28px 16px; } .step { grid-template-columns: 28px 1fr; gap: 10px; } .num { width: 26px; height: 26px; font-size: 13px; } .callout, .textblock { margin-left: 0; } }
  @media print { body { background: #fff; } main { padding: 0; max-width: none; } .step, .callout { break-inside: avoid; } img { box-shadow: none; } }
`;

export function guideToHtml(model, { autoPrint = false } = {}) {
  const parts = [];
  for (const b of model.blocks) {
    if (b.kind === 'heading') {
      parts.push(`<h2>${escapeHtml(b.text)}</h2>`);
    } else if (b.kind === 'tip' || b.kind === 'alert') {
      parts.push(
        `<aside class="callout ${b.kind}"><strong>${b.kind === 'tip' ? 'Tip' : 'Important'}</strong>${richToHtml(b.text)}</aside>`,
      );
    } else if (b.kind === 'text') {
      parts.push(`<p class="textblock">${richToHtml(b.text)}</p>`);
    } else {
      parts.push(`<section class="step" id="step-${b.number}">
  <div class="num">${b.number}</div>
  <div>
    <p class="text">${richToHtml(b.text)}</p>
    ${b.note ? `<p class="note">${richToHtml(b.note)}</p>` : ''}
    ${b.url ? `<a class="url" href="${escapeHtml(b.url)}">${escapeHtml(b.url)}</a>` : ''}
    ${b.image ? `<figure><img src="${b.image.dataUrl}" width="${b.image.width}" height="${b.image.height}" alt="Step ${b.number}: ${escapeHtml(b.text.replace(/\*\*/g, ''))}"></figure>` : ''}
  </div>
</section>`);
    }
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.title)}</title>
<style>${CSS}</style>
</head>
<body>
<main>
<h1>${escapeHtml(model.title)}</h1>
${model.description ? `<p class="desc">${escapeHtml(model.description)}</p>` : ''}
<p class="meta">${model.stepCount} steps${model.author ? ` · ${escapeHtml(model.author)}` : ''} · ${formatDate(model.createdAt)}</p>
${parts.join('\n')}
<footer>Made with FlowDoc</footer>
</main>
${autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300))</script>' : ''}
</body>
</html>`;
}

export function exportHtml(model) {
  return new Blob([guideToHtml(model)], { type: 'text/html;charset=utf-8' });
}
