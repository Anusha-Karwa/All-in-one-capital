import { eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { documentPages, documents } from "@/db/schema";
import { extractPdf } from "@/knowledge/pdf";
import type { DocStorage } from "./storage";

export interface ParseReport {
  documents: { id: string; kind: string; pages: number; lowTextPages: number[]; error?: string }[];
  /** True when a deck is mostly images — the Gemini file-input fallback (needs keys) must read it. */
  needsVisionFallback: boolean;
}

/** Pipeline step 1 (§4): extract per-page text for every document. Idempotent (replaces pages). */
export async function parseDocuments(d: Db, applicationId: string, storage: DocStorage): Promise<ParseReport> {
  const docs = await d.select().from(documents).where(eq(documents.applicationId, applicationId));
  const report: ParseReport = { documents: [], needsVisionFallback: false };
  for (const doc of docs) {
    try {
      const bytes = await storage.get(doc.storageKey!);
      const pdf = await extractPdf(bytes);
      await d.delete(documentPages).where(eq(documentPages.documentId, doc.id));
      for (const p of pdf.pages)
        await d.insert(documentPages).values({ documentId: doc.id, pageNo: p.pageNo, text: p.text });
      await d.update(documents).set({ pageCount: pdf.pageCount }).where(eq(documents.id, doc.id));
      report.documents.push({ id: doc.id, kind: doc.kind, pages: pdf.pageCount, lowTextPages: pdf.lowTextPages });
      if (doc.kind === "deck" && pdf.pageCount > 0 && pdf.lowTextPages.length / pdf.pageCount > 0.5)
        report.needsVisionFallback = true;
    } catch (e) {
      report.documents.push({
        id: doc.id,
        kind: doc.kind,
        pages: 0,
        lowTextPages: [],
        error: (e as Error).message.slice(0, 200),
      });
    }
  }
  return report;
}
