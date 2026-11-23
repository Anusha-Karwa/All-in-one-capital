import { PDFDocument, StandardFonts } from "pdf-lib";

/** Build a text PDF for tests: one string[] of lines per page. SYNTHETIC content only. */
export async function makePdf(pages: string[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    lines.forEach((l, i) => page.drawText(l, { x: 40, y: 800 - i * 14, size: 10, font }));
  }
  return doc.save();
}
