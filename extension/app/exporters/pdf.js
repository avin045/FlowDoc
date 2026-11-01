import { formatDate, parseRuns } from '../render.js';

// jsPDF's built-in Helvetica only covers WinAnsi (Latin-1). Map common
// typographic characters and replace anything else so text never garbles.
// Guides in other scripts (Tamil, Hindi, Arabic, Chinese...) are drawn by the
// browser instead: see canvasText below.
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

// Letters Helvetica can't show (Tamil, Devanagari, Arabic, CJK...). A stray
// symbol alone doesn't count: it becomes "?" and the text stays selectable.
const NEEDS_CANVAS = /(?![\x00-\xff])[\p{L}\p{M}]/u;
const modelText = (model) => [model.title, model.description, ...model.blocks.flatMap((b) => [b.text, b.note])].join('\n');

// Lines of text drawn on a canvas, so the browser does the shaping that Indic
// and other complex scripts need, and placed in the PDF as images.
const PX_PER_PT = 4; // canvas resolution: 4 px per point is ~290 dpi
const FONT = 'system-ui, "Segoe UI", "Nirmala UI", "Noto Sans", "Noto Sans Tamil", "Noto Sans Devanagari", sans-serif';
function canvasText(rtl) {
  const ctx = document.createElement('canvas').getContext('2d');
  const font = (bold, size) => `${bold ? 700 : 400} ${size * PX_PER_PT}px ${FONT}`;
  const graphemes = (text) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((g) => g.segment);
  return {
    clean: (text) => String(text ?? ''),
    // Width in mm.
    width(text, bold, size) {
      ctx.font = font(bold, size);
      return (ctx.measureText(text).width / PX_PER_PT) * 0.3528;
    },
    // Splits a word wider than the line (also scripts without spaces).
    split(text, bold, size, width) {
      const parts = [''];
      for (const g of graphemes(text)) {
        const next = parts[parts.length - 1] + g;
        if (this.width(next, bold, size) > width && parts[parts.length - 1]) parts.push(g);
        else parts[parts.length - 1] = next;
      }
      return parts;
    },
    drawLine(doc, line, x, y, size, color, boxW) {
      const lhPt = size * 1.4;
      const wMm = line.reduce((t, seg) => t + seg.w, 0);
      if (!wMm) return;
      const c = document.createElement('canvas');
      c.width = Math.ceil((wMm / 0.3528) * PX_PER_PT) + 4;
      c.height = Math.ceil(lhPt * PX_PER_PT);
      const g = c.getContext('2d');
      g.fillStyle = `rgb(${color.join(',')})`;
      g.textBaseline = 'alphabetic';
      g.direction = rtl ? 'rtl' : 'ltr';
      let cx = rtl ? c.width - 2 : 2;
      for (const seg of line) {
        g.font = font(seg.bold, size);
        g.textAlign = rtl ? 'right' : 'left';
        g.fillText(seg.text, cx, size * PX_PER_PT * 1.05);
        cx += (rtl ? -1 : 1) * (seg.w / 0.3528) * PX_PER_PT;
      }
      const left = rtl ? x + boxW - wMm : x;
      doc.addImage(c.toDataURL('image/png'), 'PNG', left - (2 / PX_PER_PT) * 0.3528, y, (c.width / PX_PER_PT) * 0.3528, lhPt * 0.3528, undefined, 'FAST');
    },
  };
}

const ACCENT = [79, 70, 229];
const MUTED = [100, 116, 139];
const FG = [15, 23, 42];

export async function exportPdf(model, { pageSize = 'a4' } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: pageSize, compress: true });
  doc.setProperties({ title: model.title, creator: 'FlowDoc' });

  // Helvetica text, or browser-drawn text for scripts it can't show.
  const raster = NEEDS_CANVAS.test(modelText(model)) ? canvasText(!!model.rtl) : null;
  const text = raster || {
    clean: latin,
    width: (t, bold, size) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      return doc.getTextWidth(t);
    },
    split: (t, bold, size, width) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      return doc.splitTextToSize(t, width);
    },
  };

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
    const lines = [[]];
    let lineW = 0;
    for (const run of runs) {
      const pieces = text.clean(run.text).split(/(\s+|\n)/);
      for (const piece of pieces) {
        if (!piece) continue;
        if (piece.includes('\n')) {
          lines.push([]);
          lineW = 0;
          continue;
        }
        const w = text.width(piece, run.bold, size);
        const isSpace = /^\s+$/.test(piece);
        if (lineW + w > width && !isSpace && lineW > 0) {
          lines.push([]);
          lineW = 0;
        }
        if (isSpace && lineW === 0) continue;
        // Words longer than a line are hard-split.
        if (w > width) {
          for (const part of text.split(piece, run.bold, size, width)) {
            const pw = text.width(part, run.bold, size);
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

  function drawLines(lines, x, size, color = FG, boxW = contentW - (x - margin)) {
    const lh = size * 0.3528 * 1.4; // pt → mm, 1.4 line height
    if (raster) {
      for (const line of lines) {
        raster.drawLine(doc, line, x, y, size, color, boxW);
        y += lh;
      }
      return;
    }
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
        drawLines(lines, margin + indent + 5, 10.5, FG, w);
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
    if (raster) {
      const saved = y;
      y = pageH - 8 - 8 * 0.3528 * 1.05;
      drawLines(layout([{ text: model.title.slice(0, 90), bold: false }], contentW - 30, 8).slice(0, 1), margin, 8, MUTED);
      y = saved;
    } else {
      doc.text(latin(model.title).slice(0, 90), margin, pageH - 8);
    }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, pageH - 8, { align: 'right' });
  }
  return doc.output('blob');
}
