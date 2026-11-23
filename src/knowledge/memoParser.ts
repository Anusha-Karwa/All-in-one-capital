/**
 * Splits the deal-memo PDF text into 12 memos × 4 sections (§3.1).
 *
 * The company list + expected decisions come from BUILD_SPEC §3.1 (which summarises the seed); the
 * parser VERIFIES each against the memo text and reports every mismatch or missing section as a
 * parse issue — it never fills a section it could not find.
 */
export const MEMO_SECTIONS = ["what_it_does", "founder_assessment", "risks", "why_decision"] as const;
export type MemoSection = (typeof MEMO_SECTIONS)[number];

export interface MemoSpec {
  no: number;
  company: string;
  sector: string;
  decision: "INVESTED" | "PASSED";
}

export const MEMO_SPECS: readonly MemoSpec[] = [
  { no: 1, company: "The ePlane Company", sector: "Deeptech (eVTOL)", decision: "INVESTED" },
  { no: 2, company: "Petalry", sector: "Consumer brand (D2C skincare)", decision: "PASSED" },
  { no: 3, company: "Unbox Robotics", sector: "Deeptech (warehouse robotics)", decision: "INVESTED" },
  { no: 4, company: "HopBox", sector: "Consumer tech (10-min delivery)", decision: "PASSED" },
  { no: 5, company: "Wint Wealth", sector: "Fintech (bonds)", decision: "INVESTED" },
  { no: 6, company: "CampusCredit", sector: "Fintech (student credit)", decision: "PASSED" },
  { no: 7, company: "Giva", sector: "Consumer brand (jewellery)", decision: "INVESTED" },
  { no: 8, company: "AeroDrop", sector: "Deeptech (drones)", decision: "PASSED" },
  { no: 9, company: "SuperK", sector: "Consumer tech (small-town retail)", decision: "INVESTED" },
  { no: 10, company: "Coinlane", sector: "Web3 (crypto exchange)", decision: "PASSED" },
  { no: 11, company: "Jai Kisan", sector: "Fintech (rural credit)", decision: "INVESTED" },
  { no: 12, company: "Prepnest", sector: "Consumer tech (exam prep)", decision: "PASSED" },
];

const HEADINGS: Record<MemoSection, RegExp> = {
  what_it_does:
    /^(?:\d+[.)]\s*)?(what (?:it|they|the company) does?|what it is|the business|business overview|overview|company overview)\b/i,
  founder_assessment:
    /^(?:\d+[.)]\s*)?(founders?(?:'|’)? ?assessment|founder(?:s)? (?:and|&) team|founders?|the founders?|team assessment)\b/i,
  risks: /^(?:\d+[.)]\s*)?(key risks|risks?(?: and (?:concerns|mitigants))?|concerns)\b/i,
  why_decision:
    /^(?:\d+[.)]\s*)?(why we (?:invested|passed|are investing|are passing)|why (?:invest|pass)|decision(?: rationale)?|recommendation|verdict)\b/i,
};

export interface ParsedMemo {
  spec: MemoSpec;
  stage: string | null;
  source: string | null;
  sections: Partial<Record<MemoSection, { text: string; pageRef: string }>>;
  raw: string;
}

export interface MemoParseResult {
  memos: ParsedMemo[];
  issues: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pageAt = (text: string, idx: number) => {
  const m = [...text.slice(0, idx).matchAll(/\[\[page (\d+)\]\]/g)].pop();
  return m ? Number(m[1]) : null;
};

/** Find where each memo starts: the company name at the start of a line (optionally after "Memo N"/"N."). */
function memoStarts(text: string): { spec: MemoSpec; idx: number }[] {
  const out: { spec: MemoSpec; idx: number }[] = [];
  let from = 0;
  for (const spec of MEMO_SPECS) {
    const re = new RegExp(
      `^\\s*(?:(?:deal\\s+)?memo\\s*(?:#|no\\.?)?\\s*${spec.no}\\b[^\\n]*?|${spec.no}[.)]\\s*)?(?:investment memo[:\\s—-]*)?${escape(spec.company)}\\b`,
      "gim",
    );
    re.lastIndex = from;
    const m = re.exec(text);
    if (m) {
      out.push({ spec, idx: m.index });
      from = m.index + m[0].length;
    }
  }
  return out;
}

export function parseMemos(fullText: string): MemoParseResult {
  const issues: string[] = [];
  const starts = memoStarts(fullText);
  for (const s of MEMO_SPECS)
    if (!starts.find((x) => x.spec.no === s.no)) issues.push(`memo ${s.no} (${s.company}): start not found`);

  const memos: ParsedMemo[] = starts.map((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].idx : fullText.length;
    const raw = fullText.slice(s.idx, end);
    const lines = raw.split("\n");
    const marks: { section: MemoSection; line: number }[] = [];
    lines.forEach((line, ln) => {
      const t = line.trim().replace(/^[#*•\-\s]+/, "");
      if (t.length > 70) return;
      for (const sec of MEMO_SECTIONS) {
        if (HEADINGS[sec].test(t) && !marks.find((m) => m.section === sec)) {
          marks.push({ section: sec, line: ln });
          break;
        }
      }
    });
    marks.sort((a, b) => a.line - b.line);
    const sections: ParsedMemo["sections"] = {};
    marks.forEach((m, j) => {
      const stop = j + 1 < marks.length ? marks[j + 1].line : lines.length;
      // "Risks: text on the same line" → keep the text after the colon; a bare heading contributes nothing.
      const heading = lines[m.line].trim();
      const inline = heading.includes(":") ? heading.slice(heading.indexOf(":") + 1).trim() : "";
      const body = [inline, ...lines.slice(m.line + 1, stop)]
        .join("\n")
        .replace(/\[\[page \d+\]\]\n?/g, "")
        .trim();
      const offset = fullText.indexOf(lines[m.line], s.idx);
      const page = pageAt(fullText, offset);
      if (body) sections[m.section] = { text: body, pageRef: page ? `p.${page}` : "p.?" };
    });
    for (const sec of MEMO_SECTIONS)
      if (!sections[sec]) issues.push(`memo ${s.spec.no} (${s.spec.company}): section "${sec}" not found`);

    const stage = /\bstage\s*[:\-–]\s*([^\n]+)/i.exec(raw)?.[1]?.trim() ?? null;
    const source = /\bsource\s*[:\-–]\s*([^\n]+)/i.exec(raw)?.[1]?.trim() ?? null;
    const decisionWord = s.spec.decision === "INVESTED" ? /\binvest(ed|ing|ment)?\b/i : /\bpass(ed|ing)?\b/i;
    if (!decisionWord.test(sections.why_decision?.text ?? raw))
      issues.push(`memo ${s.spec.no} (${s.spec.company}): expected decision ${s.spec.decision} not evident in text`);
    return { spec: s.spec, stage, source, sections, raw };
  });
  return { memos, issues };
}
