import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { freshTestDb } from "@/db/migrate-local";
import { memoSections, memos, noteChunks, portfolioCompanies, thesisRules } from "@/db/schema";
import { makePdf } from "../../tests/makePdf";
import { embedKnowledge, importKnowledge } from "./importKnowledge";
import { MEMO_SPECS, parseMemos } from "./memoParser";
import { chunkParagraphs, parseNotes } from "./notesParser";
import { extractPdf } from "./pdf";
import { linkRules } from "./thesisRules";

// SYNTHETIC fixture text — not the real memos. Real-format tuning happens when /seed arrives.
function synthMemo(no: number, style: "colon" | "heading"): string[] {
  const s = MEMO_SPECS[no - 1];
  const verdict =
    s.decision === "INVESTED" ? "We invested because of synthetic reason." : "We passed because of synthetic reason.";
  if (style === "colon")
    return [
      `Memo ${no}: ${s.company}`,
      "Stage: Pre-seed",
      "Source: Synthetic referral",
      "What it does: Synthetic product description line.",
      "Founder assessment: Synthetic founder notes.",
      "Risks: Synthetic risk one.",
      `Why we ${s.decision === "INVESTED" ? "invested" : "passed"}: ${verdict}`,
    ];
  return [
    `${no}. ${s.company}`,
    "What it does",
    "Synthetic product description line.",
    "Founder Assessment",
    "Synthetic founder notes.",
    "Key Risks",
    "Synthetic risk one.",
    `Why we ${s.decision === "INVESTED" ? "invested" : "passed"}`,
    verdict,
  ];
}

const memoText = (style: "colon" | "heading", skip?: number) =>
  MEMO_SPECS.filter((s) => s.no !== skip)
    .map((s) => `[[page ${s.no}]]\n` + synthMemo(s.no, style).join("\n"))
    .join("\n");

describe("memo parser", () => {
  it.each(["colon", "heading"] as const)("parses 12 memos × 4 sections (%s style)", (style) => {
    const r = parseMemos(memoText(style));
    expect(r.issues).toEqual([]);
    expect(r.memos).toHaveLength(12);
    for (const m of r.memos)
      expect(Object.keys(m.sections).sort()).toEqual(["founder_assessment", "risks", "what_it_does", "why_decision"]);
    expect(r.memos[2].sections.risks?.pageRef).toBe("p.3");
    expect(r.memos[2].sections.risks?.text).toBe("Synthetic risk one.");
  });

  it("captures stage/source lines when present", () => {
    const m = parseMemos(memoText("colon")).memos[0];
    expect(m.stage).toBe("Pre-seed");
    expect(m.source).toBe("Synthetic referral");
  });

  it("reports a missing memo and a missing section instead of inventing them", () => {
    const text = memoText("heading", 7).replace("Key Risks\nSynthetic risk one.\n", "");
    const r = parseMemos(text);
    expect(r.issues).toContain("memo 7 (Giva): start not found");
    expect(r.issues.some((i) => /risks" not found/.test(i))).toBe(true);
  });

  it("flags a decision that contradicts the expected one", () => {
    const text = memoText("colon").replace(
      "Why we invested: We invested because of synthetic reason.",
      "Why we passed: We passed.",
    );
    expect(parseMemos(text).issues.some((i) => /expected decision INVESTED/.test(i))).toBe(true);
  });
});

describe("notes parser", () => {
  const notes = [1, 2, 3, 4, 5]
    .map(
      (n) =>
        `[[page ${n}]]\nPartner Meeting ${n} — 12 March 2026\nSynthetic discussion paragraph ${n}.\n\nSecond paragraph ${n}.`,
    )
    .join("\n");
  it("splits meetings, captures dates, chunks text", () => {
    const r = parseNotes(notes);
    expect(r.issues).toEqual([]);
    expect(r.meetings.map((m) => m.no)).toEqual([1, 2, 3, 4, 5]);
    expect(r.meetings[0].date).toBe("12 March 2026");
    expect(r.meetings[3].pageRef).toBe("p.4");
    expect(r.meetings[0].chunks[0].text).toContain("Synthetic discussion paragraph 1.");
  });
  it("reports missing meetings", () => {
    expect(parseNotes("Meeting 1\nx").issues).toContain("meeting 5 not found");
  });
  it("chunks long text without losing words", () => {
    const words = Array.from({ length: 700 }, (_, i) => `w${i}`).join(" ");
    const chunks = chunkParagraphs(words);
    expect(chunks.join(" ").split(" ")).toHaveLength(700);
    expect(Math.max(...chunks.map((c) => c.split(" ").length))).toBeLessThanOrEqual(260);
  });
});

describe("rule linking", () => {
  it("links only when every anchor is in one chunk, preferring the hinted meeting; otherwise unverified", () => {
    const links = linkRules([
      { id: "N2.c1", noteId: 2, text: "Aside: MeetRecord mentioned in passing." },
      {
        id: "N4.c3",
        noteId: 4,
        text: "Near miss. We almost took a call with a MeetRecord competitor. Check the full list.",
      },
      { id: "N1.c1", noteId: 1, text: "Petalry was scored 6.5 and that was too high." },
    ]);
    expect(links.find((l) => l.ruleId === "R5")).toMatchObject({ source: "notes:meeting-4#N4.c3" });
    expect(links.find((l) => l.ruleId === "R5")!.quote).toContain("MeetRecord");
    expect(links.find((l) => l.ruleId === "R1")!.source).toBe("notes:meeting-1#N1.c1");
    expect(links.find((l) => l.ruleId === "R2")).toEqual({
      ruleId: "R2",
      source: "unverified (spec §3.1)",
      quote: null,
    });
  });
});

describe("importKnowledge (PDF → DB)", () => {
  let d: Db;
  beforeEach(async () => {
    d = await freshTestDb();
  }, 30_000);

  async function pdfs() {
    const memosPdf = await makePdf(MEMO_SPECS.map((s) => synthMemo(s.no, "heading")));
    const notesPdf = await makePdf([
      ["Partner Meeting 1", "Petalry was scored 6.5 by Riya and that was too high."],
      ["Partner Meeting 2", "Synthetic discussion."],
      ["Partner Meeting 3", "Synthetic discussion."],
      ["Partner Meeting 4", "Near miss: a MeetRecord competitor nearly got a call."],
      ["Partner Meeting 5", "Synthetic discussion."],
    ]);
    return { memosPdf, notesPdf };
  }

  it("extracts per-page text from a real PDF", async () => {
    const x = await extractPdf(await makePdf([["Hello page one"], ["Page two"]]));
    expect(x.pageCount).toBe(2);
    expect(x.pages[0].text).toContain("Hello page one");
    expect(x.sha256).toHaveLength(64);
  });

  it("imports memos, notes, rules and MeetRecord, and is idempotent", async () => {
    const input = await pdfs();
    const r1 = await importKnowledge(d, input);
    expect(r1.memos).toBe(12);
    expect(r1.memoSections).toBe(48);
    expect(r1.meetings).toBe(5);
    expect(r1.rulesLinked).toEqual(expect.arrayContaining(["R1", "R5"]));
    expect(r1.rulesUnverified).toContain("R2");
    await importKnowledge(d, await pdfs());
    expect(await d.select().from(memos)).toHaveLength(12);
    expect(await d.select().from(memoSections)).toHaveLength(48);
    expect(await d.select().from(thesisRules)).toHaveLength(14);
    const pf = await d.select().from(portfolioCompanies);
    expect(pf).toHaveLength(1);
    expect(pf[0].sourceUrl).toMatch(/^notes:meeting-4#N4\.c\d+$/);
    expect((await d.select().from(noteChunks)).length).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("embedKnowledge fills only missing embeddings", async () => {
    await importKnowledge(d, await pdfs());
    let calls = 0;
    const fake = async (t: string[]) => {
      calls += t.length;
      return t.map(() => Array(768).fill(0.02));
    };
    const c1 = await embedKnowledge(d, fake);
    expect(c1.memoSections).toBe(48);
    expect(c1.portfolio).toBe(1);
    const before = calls;
    const c2 = await embedKnowledge(d, fake);
    expect(c2).toEqual({ memoSections: 0, noteChunks: 0, portfolio: 0 });
    expect(calls).toBe(before);
  }, 30_000);
});
