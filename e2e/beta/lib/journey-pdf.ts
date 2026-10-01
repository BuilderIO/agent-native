/**
 * A tiny valid PDF built in memory, so a journey needs no fixture file and no
 * network fetch. Every page carries one line of Helvetica text, which is what
 * an importer needs in order to report a page count and extract text.
 */

function escapePdfText(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

export function buildMinimalPdf(pageTexts: readonly string[]): Buffer {
  if (pageTexts.length === 0) {
    throw new Error("buildMinimalPdf needs at least one page of text.");
  }
  const pageCount = pageTexts.length;
  const firstPageObject = 4;
  const pageObject = (index: number) => firstPageObject + index * 2;
  const contentObject = (index: number) => firstPageObject + index * 2 + 1;

  const bodies = new Map<number, string>();
  bodies.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  bodies.set(
    2,
    `<< /Type /Pages /Kids [${pageTexts
      .map((_, index) => `${pageObject(index)} 0 R`)
      .join(" ")}] /Count ${pageCount} >>`,
  );
  bodies.set(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pageTexts.forEach((text, index) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${escapePdfText(text)}) Tj ET`;
    bodies.set(
      pageObject(index),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObject(index)} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    bodies.set(
      contentObject(index),
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });

  const objectCount = 3 + pageCount * 2;
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id <= objectCount; id += 1) {
    offsets.push(pdf.length);
    pdf += `${id} 0 obj\n${bodies.get(id)}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  // Pure ASCII, so string length and byte offsets are the same thing.
  return Buffer.from(pdf, "latin1");
}
