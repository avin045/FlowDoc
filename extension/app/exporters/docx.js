import { dataUrlToBytes, formatDate, parseRuns } from '../render.js';

const ACCENT = '4F46E5';

export async function exportDocx(model, { pageSize = 'a4' } = {}) {
  const {
    AlignmentType,
    BorderStyle,
    Document,
    ExternalHyperlink,
    Footer,
    HeadingLevel,
    ImageRun,
    Packer,
    PageNumber,
    Paragraph,
    ShadingType,
    TextRun,
  } = window.docx;

  // Page sizes in twips; 1" margins. Content width in px (96 dpi) for images.
  const size = pageSize === 'letter' ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 };
  const margin = 1080; // 0.75"
  const contentPx = Math.floor(((size.width - margin * 2) / 1440) * 96);
  const imagePx = contentPx - 24;

  const runs = (text, extra = {}) =>
    parseRuns(text).flatMap((r) => {
      const lines = r.text.split('\n');
      return lines.map((line, i) => new TextRun({ text: line, bold: r.bold || extra.bold, break: i > 0 ? 1 : 0, ...extra }));
    });

  const children = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: model.title })] }),
  ];
  if (model.description) children.push(new Paragraph({ spacing: { after: 120 }, children: runs(model.description) }));
  children.push(
    new Paragraph({
      spacing: { after: 240 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'E2E8F0', space: 8 } },
      children: [new TextRun({ text: `${model.stepCount} steps · ${formatDate(model.createdAt)}`, color: '64748B', size: 18 })],
    }),
  );

  for (const b of model.blocks) {
    if (b.kind === 'heading') {
      children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 120 }, children: [new TextRun(b.text)] }));
      continue;
    }
    if (b.kind === 'tip' || b.kind === 'alert') {
      const tip = b.kind === 'tip';
      children.push(
        new Paragraph({
          spacing: { before: 120, after: 240 },
          indent: { left: 360 },
          shading: { type: ShadingType.CLEAR, fill: tip ? 'EEF2FF' : 'FFF7ED', color: 'auto' },
          border: { left: { style: BorderStyle.SINGLE, size: 24, color: tip ? '6366F1' : 'F97316', space: 8 } },
          children: [new TextRun({ text: tip ? 'Tip: ' : 'Important: ', bold: true }), ...runs(b.text)],
        }),
      );
      continue;
    }
    if (b.kind === 'text') {
      children.push(new Paragraph({ spacing: { after: 200 }, children: runs(b.text) }));
      continue;
    }

    children.push(
      new Paragraph({
        spacing: { before: 240, after: 80 },
        keepNext: !!b.image,
        children: [new TextRun({ text: `${b.number}. `, bold: true, color: ACCENT, size: 26 }), ...runs(b.text, { size: 24 })],
      }),
    );
    if (b.note) children.push(new Paragraph({ spacing: { after: 80 }, keepNext: !!b.image, children: runs(b.note, { color: '475569' }) }));
    if (b.url) {
      children.push(
        new Paragraph({
          spacing: { after: 80 },
          keepNext: !!b.image,
          children: [new ExternalHyperlink({ link: b.url, children: [new TextRun({ text: b.url, style: 'Hyperlink', size: 18 })] })],
        }),
      );
    }
    if (b.image) {
      const w = Math.min(imagePx, b.image.width);
      const h = Math.round((b.image.height / b.image.width) * w);
      children.push(
        new Paragraph({
          spacing: { after: 240 },
          alignment: AlignmentType.LEFT,
          children: [
            new ImageRun({
              type: 'jpg',
              data: await dataUrlToBytes(b.image.dataUrl),
              transformation: { width: w, height: h },
              altText: { title: `Step ${b.number}`, description: b.text.replace(/\*\*/g, ''), name: `step-${b.number}` },
            }),
          ],
        }),
      );
    }
  }

  const doc = new Document({
    creator: 'FlowDoc',
    title: model.title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    sections: [
      {
        properties: { page: { size, margin: { top: margin, bottom: margin, left: margin, right: margin } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], color: '94A3B8', size: 16 })],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBlob(doc);
}
