import { eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { memoSections, memos, noteChunks, partnerNotes, portfolioCompanies, thesisRules } from "@/db/schema";
import { MEMO_SECTIONS, parseMemos } from "./memoParser";
import { parseNotes } from "./notesParser";
import { extractPdf, joinWithPageMarkers } from "./pdf";
import { linkRules, quoteAround, RULE_SEEDS } from "./thesisRules";

export interface ImportReport {
  memos: number;
  memoSections: number;
  meetings: number;
  noteChunks: number;
  rulesLinked: string[];
  rulesUnverified: string[];
  portfolioSeeded: string[];
  issues: string[];
}

const MEMO_FILE = "MESA_T2_Case 03_Deal Memos.pdf";
const NOTES_FILE = "MESA_T2_Case 03_Partner Meeting Notes.pdf";

/** Import memos, partner notes, rules R1–R14 and note-sourced portfolio rows. Idempotent (upserts). */
export async function importKnowledge(
  d: Db,
  input: { memosPdf: Uint8Array; notesPdf: Uint8Array; memosFile?: string; notesFile?: string },
): Promise<ImportReport> {
  const issues: string[] = [];
  const memosFile = input.memosFile ?? MEMO_FILE;
  const notesFile = input.notesFile ?? NOTES_FILE;

  // ── memos
  const memoPdf = await extractPdf(input.memosPdf);
  if (memoPdf.lowTextPages.length) issues.push(`memos: low-text pages ${memoPdf.lowTextPages.join(",")} (image-only?)`);
  const parsed = parseMemos(joinWithPageMarkers(memoPdf.pages));
  issues.push(...parsed.issues);
  let sectionCount = 0;
  for (const m of parsed.memos) {
    const row = {
      id: m.spec.no,
      company: m.spec.company,
      sector: m.spec.sector,
      stage: m.stage,
      source: m.source,
      decision: m.spec.decision,
      sourceRef: `seed/memos/${memosFile}`,
    };
    await d.insert(memos).values(row).onConflictDoUpdate({ target: memos.id, set: row });
    for (const sec of MEMO_SECTIONS) {
      const s = m.sections[sec];
      if (!s) continue;
      const id = `M${m.spec.no}.${sec}`;
      // Text changed → drop the stale embedding so the embed pass recomputes it.
      await d
        .insert(memoSections)
        .values({ id, memoId: m.spec.no, section: sec, text: s.text, pageRef: s.pageRef })
        .onConflictDoUpdate({
          target: memoSections.id,
          set: {
            text: s.text,
            pageRef: s.pageRef,
            embedding: sql`case when ${memoSections.text} = ${s.text} then ${memoSections.embedding} else null end`,
          },
        });
      sectionCount++;
    }
  }

  // ── partner notes
  const notesPdf = await extractPdf(input.notesPdf);
  if (notesPdf.lowTextPages.length)
    issues.push(`notes: low-text pages ${notesPdf.lowTextPages.join(",")} (image-only?)`);
  const notes = parseNotes(joinWithPageMarkers(notesPdf.pages));
  issues.push(...notes.issues);
  const chunkRefs: { id: string; noteId: number; text: string }[] = [];
  for (const mt of notes.meetings) {
    const row = {
      id: mt.no,
      title: mt.title,
      meetingDate: mt.date,
      sourceRef: `seed/notes/${notesFile} ${mt.pageRef}`,
    };
    await d.insert(partnerNotes).values(row).onConflictDoUpdate({ target: partnerNotes.id, set: row });
    await d.delete(noteChunks).where(eq(noteChunks.noteId, mt.no)); // chunk boundaries may shift between imports
    for (const c of mt.chunks) {
      const id = `N${mt.no}.c${c.chunkNo}`;
      await d.insert(noteChunks).values({ id, noteId: mt.no, chunkNo: c.chunkNo, text: c.text });
      chunkRefs.push({ id, noteId: mt.no, text: c.text });
    }
  }

  // ── rules R1–R14, linked to verbatim note quotes where the anchors are found
  const links = linkRules(chunkRefs);
  for (const seed of RULE_SEEDS) {
    const link = links.find((l) => l.ruleId === seed.id)!;
    const row = {
      id: seed.id,
      text: seed.text,
      source: link.source,
      quote: link.quote,
      sectors: seed.sectors,
      stages: seed.stages,
    };
    await d.insert(thesisRules).values(row).onConflictDoUpdate({ target: thesisRules.id, set: row });
  }

  // ── portfolio: MeetRecord from Meeting 4 (R5). Seeded even if not found in the notes —
  //    a false-alarm conflict flag is preferred to a missed one — but then marked unverified.
  const portfolioSeeded: string[] = [];
  const mr = chunkRefs.find((c) => /meetrecord/i.test(c.text));
  const mrRow = {
    name: "MeetRecord",
    oneLiner: mr ? quoteAround(mr.text, /meetrecord/i) : null,
    sourceUrl: mr ? `notes:meeting-${mr.noteId}#${mr.id}` : "spec §3.1 (unverified: not found in imported notes)",
    addedBy: "notes" as const,
  };
  const [existing] = await d.select().from(portfolioCompanies).where(eq(portfolioCompanies.name, "MeetRecord"));
  if (existing) await d.update(portfolioCompanies).set(mrRow).where(eq(portfolioCompanies.id, existing.id));
  else await d.insert(portfolioCompanies).values(mrRow);
  portfolioSeeded.push("MeetRecord");
  if (!mr) issues.push("MeetRecord not found in partner notes — seeded from spec, marked unverified");

  return {
    memos: parsed.memos.length,
    memoSections: sectionCount,
    meetings: notes.meetings.length,
    noteChunks: chunkRefs.length,
    rulesLinked: links.filter((l) => l.quote).map((l) => l.ruleId),
    rulesUnverified: links.filter((l) => !l.quote).map((l) => l.ruleId),
    portfolioSeeded,
    issues,
  };
}

export type EmbedFn = (texts: string[]) => Promise<number[][]>;

/** Fill missing embeddings for memo sections, note chunks and portfolio rows. Re-runnable; embeds only NULLs. */
export async function embedKnowledge(d: Db, embedFn: EmbedFn, batch = 50) {
  const counts = { memoSections: 0, noteChunks: 0, portfolio: 0 };
  const run = async <R extends { id: string; text: string }>(
    rows: R[],
    write: (id: string, v: number[]) => Promise<unknown>,
  ) => {
    for (let i = 0; i < rows.length; i += batch) {
      const slice = rows.slice(i, i + batch);
      const vecs = await embedFn(slice.map((r) => r.text));
      for (let j = 0; j < slice.length; j++) await write(slice[j].id, vecs[j]);
    }
    return rows.length;
  };
  const secs = await d
    .select({ id: memoSections.id, text: memoSections.text })
    .from(memoSections)
    .where(isNull(memoSections.embedding));
  counts.memoSections = await run(secs, (id, v) =>
    d.update(memoSections).set({ embedding: v }).where(eq(memoSections.id, id)),
  );
  const chunks = await d
    .select({ id: noteChunks.id, text: noteChunks.text })
    .from(noteChunks)
    .where(isNull(noteChunks.embedding));
  counts.noteChunks = await run(chunks, (id, v) =>
    d.update(noteChunks).set({ embedding: v }).where(eq(noteChunks.id, id)),
  );
  const pf = await d.select().from(portfolioCompanies).where(isNull(portfolioCompanies.embedding));
  counts.portfolio = await run(
    pf.map((p) => ({
      id: p.id,
      text: [p.name, p.oneLiner, p.sector, p.keywords.join(", ")].filter(Boolean).join(" — "),
    })),
    (id, v) => d.update(portfolioCompanies).set({ embedding: v }).where(eq(portfolioCompanies.id, id)),
  );
  return counts;
}
