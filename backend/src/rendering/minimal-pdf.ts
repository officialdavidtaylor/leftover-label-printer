import type { PdfTemplateLayout } from './template-types.ts';

export function buildDeterministicPdf(layout: PdfTemplateLayout, lines: string[]): Uint8Array {
  const textCommands = buildTextCommands(layout, lines);
  const contentStream = `${textCommands}\n`;

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${layout.pageWidth} ${layout.pageHeight}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    `<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  return serializePdf(objects);
}

function buildTextCommands(layout: PdfTemplateLayout, lines: string[]): string {
  const commands = ['BT', `/F1 ${layout.fontSize} Tf`, `${layout.originX} ${layout.originY} Td`];

  lines.forEach((line, index) => {
    if (index > 0) {
      commands.push(`0 -${layout.lineHeight} Td`);
    }

    commands.push(`(${escapePdfText(line)}) Tj`);
  });

  commands.push('ET');
  return commands.join('\n');
}

function escapePdfText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)');
}

function serializePdf(objects: string[]): Uint8Array {
  let output = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((objectBody, index) => {
    const objectId = index + 1;
    offsets.push(Buffer.byteLength(output, 'utf8'));
    output += `${objectId} 0 obj\n${objectBody}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(output, 'utf8');

  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (const offset of offsets) {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  output += `startxref\n${xrefOffset}\n`;
  output += '%%EOF\n';

  return Buffer.from(output, 'utf8');
}
