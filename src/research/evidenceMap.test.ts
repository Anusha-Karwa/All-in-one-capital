import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  codeCheckMissing,
  EVIDENCE_FIELDS,
  EVIDENCE_MAP,
  type EvidenceClaim,
  type EvidenceContext,
  missingKeyNumbers,
  researchableMissing,
} from "./evidenceMap";

const ctx = (claims: EvidenceClaim[], extra: Partial<EvidenceContext> = {}): EvidenceContext => ({
  claims,
  founderIds: ["F-1001"],
  portfolioCheckRanOverFullList: false,
  searchedFields: new Set(),
  ...extra,
});
const deck = (field: EvidenceClaim["field"], valueNum?: number, subjectId?: string): EvidenceClaim => ({
  field,
  sourceType: "deck",
  sourceRef: "deck p.1",
  valueNum,
  subjectId,
  selfAuthored: true,
});

describe("evidence map", () => {
  it("has exactly one row per field, in declared order", () => {
    expect(EVIDENCE_MAP.map((r) => r.field)).toEqual([...EVIDENCE_FIELDS]);
  });

  it("is documented in docs/EVIDENCE_MAP.md (every field)", () => {
    const md = readFileSync("docs/EVIDENCE_MAP.md", "utf8");
    for (const f of EVIDENCE_FIELDS) expect(md, f).toContain(`\`${f}\``);
  });

  it("with nothing known, everything is missing", () => {
    expect(codeCheckMissing(ctx([]))).toEqual([...EVIDENCE_FIELDS]);
  });

  it("R1: key numbers are reported as missing so the scorer must penalise them", () => {
    const m = missingKeyNumbers(ctx([deck("revenue_or_mrr", 78000)]));
    expect(m).toContain("repeat_or_retention");
    expect(m).toContain("cac");
    expect(m).not.toContain("revenue_or_mrr");
  });

  it("a text-only claim does not satisfy a numeric field (no silent fill)", () => {
    const c: EvidenceClaim = { ...deck("cac"), valueText: "CAC not measured yet" };
    expect(codeCheckMissing(ctx([c]))).toContain("cac");
  });

  it("stale claims (>18 months) do not count as sufficient", () => {
    const c: EvidenceClaim = { ...deck("repeat_or_retention", 0.31), isStale: true };
    expect(codeCheckMissing(ctx([c]))).toContain("repeat_or_retention");
  });

  it("founder backgrounds need an INDEPENDENT source for every founder (R2: evidence not pedigree)", () => {
    const selfReported = deck("founder_backgrounds_verified", undefined, "F-1001");
    expect(codeCheckMissing(ctx([selfReported]))).toContain("founder_backgrounds_verified");
    const independent: EvidenceClaim = { ...selfReported, sourceType: "web", selfAuthored: false };
    expect(codeCheckMissing(ctx([independent]))).not.toContain("founder_backgrounds_verified");
    // second founder still unverified
    expect(codeCheckMissing(ctx([independent], { founderIds: ["F-1001", "F-1002"] }))).toContain(
      "founder_backgrounds_verified",
    );
  });

  it("competitors from the deck alone are not enough — web research must test the claim", () => {
    expect(codeCheckMissing(ctx([deck("competitors_named")]))).toContain("competitors_named");
    const web: EvidenceClaim = { ...deck("competitors_named"), sourceType: "search", selfAuthored: false };
    expect(codeCheckMissing(ctx([web]))).not.toContain("competitors_named");
  });

  it("portfolio overlap is satisfied only by a full-list check, never by the web", () => {
    expect(codeCheckMissing(ctx([]))).toContain("portfolio_overlap_candidates");
    expect(codeCheckMissing(ctx([], { portfolioCheckRanOverFullList: true }))).not.toContain(
      "portfolio_overlap_candidates",
    );
    expect(researchableMissing(ctx([]))).not.toContain("portfolio_overlap_candidates");
  });

  it("press: a search that found nothing counts as answered (absence recorded)", () => {
    expect(codeCheckMissing(ctx([], { searchedFields: new Set(["press_mentions"]) }))).not.toContain("press_mentions");
  });

  it("only fields with a fetch budget are offered to the research loop", () => {
    for (const f of researchableMissing(ctx([]))) {
      expect(EVIDENCE_MAP.find((r) => r.field === f)!.fetchLimit).toBeGreaterThan(0);
    }
    expect(researchableMissing(ctx([]))).not.toContain("cac");
  });
});
