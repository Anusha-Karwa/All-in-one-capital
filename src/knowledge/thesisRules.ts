/**
 * Partner-note rules R1–R14 (BUILD_SPEC §3.1). The rule TEXT comes from the spec's summary of the
 * partner notes; the CITATION (meeting #, chunk id, verbatim quote) is attached only by `linkRules`
 * finding the anchors in the imported notes. Unlinked rules keep source "unverified" and show as a gap.
 */
export interface RuleSeed {
  id: string;
  text: string;
  /** Meeting # the spec attributes the rule to, if it says. Used to prefer that meeting when linking. */
  meetingHint: number | null;
  /** ALL of these (case-insensitive regex) must appear in one chunk for it to count as the source. */
  anchors: RegExp[];
  sectors: string[]; // empty = global
  stages: string[];
}

export const RULE_SEEDS: readonly RuleSeed[] = [
  {
    id: "R1",
    text: "A missing key number drags the score; it is not skipped (Petalry was scored 6.5 — too high).",
    meetingHint: null,
    anchors: [/petalry/i, /6\.5/],
    sectors: [],
    stages: [],
  },
  {
    id: "R2",
    text: "Score the evidence, not the pedigree — credentials are not a business (AeroDrop scored 7.5 — too high).",
    meetingHint: null,
    anchors: [/aerodrop/i, /7\.5/],
    sectors: [],
    stages: [],
  },
  {
    id: "R3",
    text: "Score founder quality and path to market as separate criteria.",
    meetingHint: 3,
    anchors: [/founder/i, /(path to market|go-to-market|market)/i, /separate/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R4",
    text: "A founder getting defensive on a weak spot is information — record it (not observable from a deck → 'not assessable at triage').",
    meetingHint: null,
    anchors: [/defensive/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R5",
    text: "Run the portfolio conflict check against the FULL portfolio list on every application; prefer a false-alarm flag to a missed conflict. Default for competitors is no/hold unless partners decide otherwise.",
    meetingHint: 4,
    anchors: [/meetrecord/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R6",
    text: "The sector label matters less than whether the founders own the core risk (Jai Kisan vs CampusCredit).",
    meetingHint: null,
    anchors: [/jai kisan/i, /campuscredit/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R7",
    text: "Capital-structure fit: a model that only works with far more capital than a pre-seed cheque is a structural pass even with great founders (HopBox).",
    meetingHint: null,
    anchors: [/hopbox/i, /(capital|cheque|structure)/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R8",
    text: "A business that depends on a favourable regulatory change is not underwritten at pre-seed (Coinlane); a long regulatory path is OK if founders have a concrete milestone plan (ePlane vs AeroDrop).",
    meetingHint: null,
    anchors: [/coinlane/i, /regulat/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R9",
    text: "Consumer brands live or die on repeat/cohort data and gross margin; if repeat is good, CAC is survivable.",
    meetingHint: null,
    anchors: [/repeat/i, /(consumer|brand)/i],
    sectors: ["consumer_brand"],
    stages: [],
  },
  {
    id: "R10",
    text: "Thesis drift is unresolved: stated public thesis vs revealed behaviour. Score against both and say which one drove the recommendation and why.",
    meetingHint: null,
    anchors: [/thesis/i, /(drift|which one|stated|revealed)/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R11",
    text: "Calls are Tuesday or Thursday afternoons, 30 minutes; Aditya joins only for deeptech; for deeptech the second call is done by partners, not delegated.",
    meetingHint: null,
    anchors: [/(tuesday|tue)/i, /(thursday|thu)/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R12",
    text: "Nobody is auto-rejected or auto-advanced; Kushal sees every outcome.",
    meetingHint: null,
    anchors: [/(auto|automatic)/i, /(reject|advance)/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R13",
    text: "When a score is corrected, the corrector writes one line of why, so it can be reused for similar companies.",
    meetingHint: null,
    anchors: [/(one line|one-line|a line)/i, /(why|reason)/i],
    sectors: [],
    stages: [],
  },
  {
    id: "R14",
    text: "Uneasy past decisions to re-examine: Prepnest (a similar-format competitor later did well) and Ledgerly (not in the pack — notes missing).",
    meetingHint: null,
    anchors: [/prepnest/i],
    sectors: [],
    stages: [],
  },
];

export interface NoteChunkRef {
  id: string; // N4.c2
  noteId: number;
  text: string;
}

export interface RuleLink {
  ruleId: string;
  source: string; // "notes:meeting-4#N4.c2" | "unverified (spec §3.1)"
  quote: string | null;
}

/** Shortest sentence window containing the first anchor (≤300 chars) — the verbatim quote shown in the UI. */
export function quoteAround(text: string, anchor: RegExp): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => anchor.test(s)) ?? text;
  return hit.length > 300 ? `${hit.slice(0, 297)}…` : hit;
}

export function linkRules(chunks: NoteChunkRef[], seeds: readonly RuleSeed[] = RULE_SEEDS): RuleLink[] {
  return seeds.map((r) => {
    const matches = chunks.filter((c) => r.anchors.every((a) => a.test(c.text)));
    const best =
      matches.find((c) => r.meetingHint !== null && c.noteId === r.meetingHint) ??
      (r.meetingHint === null ? matches[0] : undefined) ??
      matches[0];
    if (!best) return { ruleId: r.id, source: "unverified (spec §3.1)", quote: null };
    return {
      ruleId: r.id,
      source: `notes:meeting-${best.noteId}#${best.id}`,
      quote: quoteAround(best.text, r.anchors[0]),
    };
  });
}
