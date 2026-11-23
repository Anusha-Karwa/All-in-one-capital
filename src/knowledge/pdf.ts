import { createHash } from "node:crypto";
import { extractText, getDocumentProxy } from "unpdf";

export interface ExtractedPdf {
  sha256: string;
  pageCount: number;
  pages: { pageNo: number; text: string }[];
  /** Pages with almost no text — likely image-only (Gemini file input fallback in Phase 3). */
  lowTextPages: number[];
}

export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const pdf = await getDocumentProxy(new Uint8Array(bytes)); // unpdf may detach the buffer; pass a copy
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t, i) => ({ pageNo: i + 1, text: normalise(t) }));
  return {
    sha256,
    pageCount: totalPages,
    pages,
    lowTextPages: pages.filter((p) => p.text.split(/\s+/).filter(Boolean).length < 15).map((p) => p.pageNo),
  };
}

export function normalise(t: string): string {
  return t
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Join pages keeping a page marker so parsers can cite "p.N". */
export function joinWithPageMarkers(pages: { pageNo: number; text: string }[]): string {
  return pages.map((p) => `\n[[page ${p.pageNo}]]\n${p.text}`).join("\n");
}
