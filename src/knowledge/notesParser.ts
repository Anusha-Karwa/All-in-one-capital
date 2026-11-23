/** Splits the partner-meeting-notes text into meetings and ~150-word chunks (paragraph-aligned). */
export interface ParsedMeeting {
  no: number;
  title: string;
  date: string | null;
  pageRef: string;
  chunks: { chunkNo: number; text: string }[];
}

const MEETING_RE = /^\s*(?:partner\s+)?meeting\s*(?:#|no\.?)?\s*(\d+)\b([^\n]*)$/gim;
const DATE_RE =
  /\b(\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/i;

export function chunkParagraphs(text: string, target = 150, max = 260): string[] {
  const paras = text
    .split(/\n\s*\n|\n(?=[•\-*]\s)/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const out: string[] = [];
  let cur: string[] = [];
  let words = 0;
  const flush = () => {
    if (cur.length) out.push(cur.join("\n"));
    cur = [];
    words = 0;
  };
  for (const p of paras) {
    const w = p.split(" ").length;
    if (w > max) {
      flush();
      const ws = p.split(" ");
      for (let i = 0; i < ws.length; i += target) out.push(ws.slice(i, i + target).join(" "));
      continue;
    }
    if (words + w > max) flush();
    cur.push(p);
    words += w;
    if (words >= target) flush();
  }
  flush();
  return out;
}

export function parseNotes(fullText: string): { meetings: ParsedMeeting[]; issues: string[] } {
  const issues: string[] = [];
  const heads = [...fullText.matchAll(MEETING_RE)]
    .map((m) => ({ no: Number(m[1]), rest: m[2].trim(), idx: m.index! }))
    // keep the first occurrence of each meeting number, in order
    .filter((h, i, a) => a.findIndex((x) => x.no === h.no) === i);
  if (!heads.length) issues.push("no 'Meeting N' headings found");
  const meetings = heads.map((h, i) => {
    const end = i + 1 < heads.length ? heads[i + 1].idx : fullText.length;
    const body = fullText.slice(h.idx, end);
    const page = [...fullText.slice(0, h.idx).matchAll(/\[\[page (\d+)\]\]/g)].pop()?.[1];
    const text = body
      .split("\n")
      .slice(1)
      .join("\n")
      .replace(/\[\[page \d+\]\]\n?/g, "");
    return {
      no: h.no,
      title: h.rest.replace(/^[:\-–—\s]+/, "") || `Meeting ${h.no}`,
      date: DATE_RE.exec(body.slice(0, 400))?.[1] ?? null,
      pageRef: page ? `p.${page}` : "p.?",
      chunks: chunkParagraphs(text).map((t, j) => ({ chunkNo: j + 1, text: t })),
    };
  });
  for (let n = 1; n <= 5; n++) if (!meetings.find((m) => m.no === n)) issues.push(`meeting ${n} not found`);
  return { meetings, issues };
}
