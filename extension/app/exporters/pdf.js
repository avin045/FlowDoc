import { formatDate, parseRuns } from '../render.js';

// jsPDF's built-in Helvetica only covers WinAnsi (Latin-1). Map common
// typographic characters and replace anything else so text never garbles.
// (Print → "Save as PDF" is the fallback for other scripts.)
function latin(text) {
  return String(text ?? '')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/⚠/g, '!')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x00-\xff]/g, '?');
}

const ACCENT = [79, 70, 229];
const MUTED = [100, 116, 139];
const FG = [15, 23, 42];

export async function exportPdf(model, { pageSize = 'a4' } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: pageSize, compress: true });
  doc.setProperties({ title: model.title, creator: 'FlowDoc' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;
  const bottom = pageH - 16;
  let y = margin;

  const newPage = () => {
    doc.addPage();
    y = margin;
  };
  const ensure = (h) => {
    if (y + h > bottom && y > margin + 1) newPage();
  };

  // Lays out mixed bold/regular runs with word wrapping. Returns the lines so
  // the height can be measured before drawing.
  function layout(runs, width, size) {
    doc.setFontSize(size);
    const lines = [[]];
    let lineW = 0;
    for (const run of runs) {
      doc.setFont('helvetica', run.bold ? 'bold' : 'normal');
      const pieces = latin(run.text).split(/(\s+|\n)/);
      for (const piece of pieces) {
        if (!piece) continue;
        if (piece.includes('\n')) {
          lines.push([]);
          lineW = 0;
          continue;
        }
        const w = doc.getTextWidth(piece);
        const isSpace = /^\s+$/.test(piece);
        if (lineW + w > width && !isSpace && lineW > 0) {
          lines.push([]);
          lineW = 0;
        }
        if (isSpace && lineW === 0) continue;
        // Words longer than a line are hard-split.
        if (w > width) {
          for (const part of doc.splitTextToSize(piece, width)) {
            const pw = doc.getTextWidth(part);
            if (lineW > 0) lines.push([]);
            lines[lines.length - 1].push({ text: part, bold: run.bold, w: pw });
            lineW = pw;
          }
          continue;
        }
        lines[lines.length - 1].push({ text: piece, bold: run.bold, w });
        lineW += w;
      }
    }
    return lines;
  }

  function drawLines(lines, x, size, color = FG) {
    const lh = size * 0.3528 * 1.4; // pt → mm, 1.4 line height
    doc.setFontSize(size);
    doc.setTextColor(...color);
    for (const line of lines) {
      let cx = x;
      for (const seg of line) {
        doc.setFont('helvetica', seg.bold ? 'bold' : 'normal');
        doc.text(seg.text, cx, y + lh * 0.75);
        cx += seg.w;
      }
      y += lh;
    }
  }
  const linesHeight = (lines, size) => lines.length * size * 0.3528 * 1.4;

  // ---- title block ----
  const titleLines = layout([{ text: model.title, bold: true }], contentW, 22);
  drawLines(titleLines, margin, 22);
  y += 2;
  if (model.description) {
    const lines = layout(parseRuns(model.description), contentW, 11);
    drawLines(lines, margin, 11, [51, 65, 85]);
    y += 2;
  }
  drawLines(layout([{ text: `${model.stepCount} steps  ·  ${formatDate(model.createdAt)}`, bold: false }], contentW, 9), margin, 9, MUTED);
  y += 3;
  doc.setDrawColor(226, 232, 240);
  doc.line(margin, y, pageW - margin, y);
  y += 8;

  // ---- blocks ----
  const indent = 11;
  for (const b of model.blocks) {
    if (b.kind === 'heading') {
      const lines = layout([{ text: b.text, bold: true }], contentW, 15);
      ensure(linesHeight(lines, 15) + 20);
      y += 3;
      drawLines(lines, margin, 15);
      y += 4;
      continue;
    }
    if (b.kind === 'tip' || b.kind === 'alert' || b.kind === 'text') {
      const label = b.kind === 'tip' ? 'TIP' : b.kind === 'alert' ? 'IMPORTANT' : '';
      const runs = [...(label ? [{ text: `${label}\n`, bold: true }] : []), ...parseRuns(b.text)];
      const w = contentW - indent - (label ? 10 : 0);
      const lines = layout(runs, w, 10.5);
      const h = linesHeight(lines, 10.5);
      ensure(h + 8);
      if (label) {
        const fill = b.kind === 'tip' ? [238, 242, 255] : [255, 247, 237];
        const bar = b.kind === 'tip' ? [99, 102, 241] : [249, 115, 22];
        doc.setFillColor(...fill);
        doc.roundedRect(margin + indent, y, contentW - indent, h + 6, 1.5, 1.5, 'F');
        doc.setFillColor(...bar);
        doc.rect(margin + indent, y, 1.2, h + 6, 'F');
        y += 3;
        drawLines(lines, margin + indent + 5, 10.5);
        y += 9;
      } else {
        drawLines(lines, margin + indent, 10.5);
        y += 6;
      }
      continue;
    }

    // numbered step
    const textW = contentW - indent;
    const textLines = layout(parseRuns(b.text), textW, 12);
    const noteLines = b.note ? layout(parseRuns(b.note), textW, 10) : [];
    const urlLines = b.url ? layout([{ text: b.url, bold: false }], textW, 8.5) : [];
    let imgW = 0;
    let imgH = 0;
    if (b.image) {
      const maxH = bottom - margin - 30;
      imgW = textW;
      imgH = (b.image.height / b.image.width) * imgW;
      if (imgH > maxH) {
        imgH = maxH;
        imgW = (b.image.width / b.image.height) * imgH;
      }
    }
    const textH = linesHeight(textLines, 12) + linesHeight(noteLines, 10) + linesHeight(urlLines, 8.5);
    // Keep a step's text together with its screenshot.
    ensure(textH + (imgH ? imgH + 4 : 0) + 4);

    const top = y;
    doc.setFillColor(...ACCENT);
    doc.circle(margin + 3.6, top + 3.4, 3.6, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(255, 255, 255);
    doc.text(String(b.number), margin + 3.6, top + 4.6, { align: 'center' });

    drawLines(textLines, margin + indent, 12);
    if (noteLines.length) {
      y += 0.5;
      drawLines(noteLines, margin + indent, 10, [71, 85, 105]);
    }
    if (urlLines.length) {
      const urlTop = y;
      drawLines(urlLines, margin + indent, 8.5, ACCENT);
      doc.link(margin + indent, urlTop, textW, y - urlTop, { url: b.url });
    }
    if (b.image) {
      y += 2;
      doc.addImage(b.image.dataUrl, 'JPEG', margin + indent, y, imgW, imgH, undefined, 'FAST');
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.3);
      doc.roundedRect(margin + indent, y, imgW, imgH, 1, 1, 'S');
      y += imgH;
    }
    y += 9;
  }

  // ---- footer ----
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(latin(model.title).slice(0, 90), margin, pageH - 8);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 8, { align: 'right' });
  }
  return doc.output('blob');
}
