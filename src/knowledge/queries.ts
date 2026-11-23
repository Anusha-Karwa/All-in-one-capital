import { asc, cosineDistance, ilike, isNotNull, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memoSections, memos, noteChunks, partnerNotes, thesisRules } from "@/db/schema";

export type SearchMode = "all" | "keyword" | "semantic";

export async function loadMemos(d: Db, q: string, queryVector?: number[]) {
  const allMemos = await d.select().from(memos).orderBy(asc(memos.id));
  let sections;
  let mode: SearchMode = "all";
  if (q && queryVector) {
    mode = "semantic";
    sections = await d
      .select({
        id: memoSections.id,
        memoId: memoSections.memoId,
        section: memoSections.section,
        text: memoSections.text,
        pageRef: memoSections.pageRef,
        distance: cosineDistance(memoSections.embedding, queryVector),
      })
      .from(memoSections)
      .where(isNotNull(memoSections.embedding))
      .orderBy(cosineDistance(memoSections.embedding, queryVector))
      .limit(12);
  } else if (q) {
    mode = "keyword";
    sections = await d
      .select()
      .from(memoSections)
      .where(ilike(memoSections.text, `%${q}%`))
      .orderBy(asc(memoSections.id));
  } else {
    sections = await d.select().from(memoSections).orderBy(asc(memoSections.memoId), asc(memoSections.id));
  }
  return { memos: allMemos, sections, mode };
}

export async function loadNotes(d: Db, q: string, queryVector?: number[]) {
  const notes = await d.select().from(partnerNotes).orderBy(asc(partnerNotes.id));
  const rules = await d
    .select()
    .from(thesisRules)
    .orderBy(sql`length(${thesisRules.id}), ${thesisRules.id}`);
  let chunks;
  let mode: SearchMode = "all";
  if (q && queryVector) {
    mode = "semantic";
    chunks = await d
      .select({ id: noteChunks.id, noteId: noteChunks.noteId, chunkNo: noteChunks.chunkNo, text: noteChunks.text })
      .from(noteChunks)
      .where(isNotNull(noteChunks.embedding))
      .orderBy(cosineDistance(noteChunks.embedding, queryVector))
      .limit(12);
  } else if (q) {
    mode = "keyword";
    chunks = await d
      .select()
      .from(noteChunks)
      .where(or(ilike(noteChunks.text, `%${q}%`)))
      .orderBy(asc(noteChunks.noteId), asc(noteChunks.chunkNo));
  } else {
    chunks = await d.select().from(noteChunks).orderBy(asc(noteChunks.noteId), asc(noteChunks.chunkNo));
  }
  return { notes, chunks, rules, mode };
}
