import { describe, expect, it } from "vitest";
import { type ConsistencyClaim, findContradictions, severityFor } from "./consistency";

// Shapes mirror the §3.2 verified findings (test fixtures only; never in prompts).
let n = 0;
const c = (p: Omit<ConsistencyClaim, "id" | "sourceRef"> & { sourceRef?: string }): ConsistencyClaim => ({
  id: `c${++n}`,
  sourceRef: p.sourceType === "deck" ? "deck p.1" : "form",
  ...p,
});

describe("consistency checker", () => {
  it("EarnWise-style credential inflation → critical text contradiction (unjudged, still flagged)", () => {
    const r = findContradictions([
      c({
        field: "founder_credentials",
        sourceType: "deck",
        valueText: "Ex-Goldman Sachs. Ex-Google. MBA, IIM Ahmedabad",
      }),
      c({
        field: "founder_credentials",
        sourceType: "form",
        valueText: "10-week IB summer internship; 5-month vendor contract; tier-2 MBA",
      }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "text_mismatch", severity: "critical", status: "unjudged" });
  });

  it("EarnWise-style team size and live clients differ → flagged", () => {
    const r = findContradictions([
      c({ field: "team_size", sourceType: "deck", valueNum: 12 }),
      c({ field: "team_size", sourceType: "form", valueNum: 5 }),
      c({ field: "paying_customers_count", sourceType: "deck", valueNum: 3 }),
      c({ field: "paying_customers_count", sourceType: "form", valueNum: 1 }),
    ]);
    expect(r.map((x) => [x.field, x.severity])).toEqual([
      ["paying_customers_count", "high"],
      ["team_size", "low"],
    ]);
  });

  it("StockSathi-style: 38 vs 42 retailers; credit source text differs (critical)", () => {
    const r = findContradictions([
      c({ field: "paying_customers_count", sourceType: "deck", valueNum: 38 }),
      c({ field: "paying_customers_count", sourceType: "form", valueNum: 42 }),
      c({
        field: "credit_source",
        sourceType: "deck",
        valueText: "funded from our own capital for now; NBFC partnership in discussion",
      }),
      c({
        field: "credit_source",
        sourceType: "form",
        valueText: "provided through our NBFC partner; we take the first-loss risk",
      }),
    ]);
    expect(r[0]).toMatchObject({ field: "credit_source", severity: "critical" });
    expect(r[1]).toMatchObject({ field: "paying_customers_count", kind: "value_mismatch" });
  });

  it("StockSathi-style CAC: deck actual ₹2,860 vs form ₹2,000; deck's ₹2,000 is a TARGET presented as actual", () => {
    const r = findContradictions([
      c({ field: "cac", sourceType: "deck", valueNum: 2860, qualifier: "actual" }),
      c({ field: "cac", sourceType: "deck", valueNum: 2000, qualifier: "target" }),
      c({ field: "cac", sourceType: "form", valueNum: 2000 }),
    ]);
    const kinds = r.map((x) => x.kind).sort();
    expect(kinds).toContain("metric_definition");
    expect(r.find((x) => x.kind === "metric_definition")!.explanation).toMatch(/target/);
  });

  it("CAPilot-style: deck 31 paying vs form 24 paying (+7 trial) → value mismatch; trial not compared to paying", () => {
    const r = findContradictions([
      c({ field: "paying_customers_count", sourceType: "deck", valueNum: 31, qualifier: "paying" }),
      c({ field: "paying_customers_count", sourceType: "form", valueNum: 24, qualifier: "paying" }),
      c({ field: "paying_customers_count", sourceType: "form", valueNum: 7, qualifier: "trial" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "value_mismatch", severity: "high" });
  });

  it("RentRoute-style: deck ₹11 L 'revenue' is the GROSS figure; form net ₹5.5 L → metric definition", () => {
    const r = findContradictions([
      c({ field: "revenue_or_mrr", sourceType: "deck", valueNum: 11, unit: "L" }),
      c({ field: "revenue_or_mrr", sourceType: "form", valueNum: 11, unit: "L", qualifier: "gross" }),
      c({ field: "revenue_or_mrr", sourceType: "form", valueNum: 5.5, unit: "L", qualifier: "net" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].kind).toBe("metric_definition");
    expect(r[0].explanation).toMatch(/gross/);
  });

  it("RentRoute-style users: deck 1,900 'users' vs form 1,100 paying → flagged; matches 1,900 registered", () => {
    const r = findContradictions([
      c({ field: "users_count", sourceType: "deck", valueNum: 1900 }),
      c({ field: "users_count", sourceType: "form", valueNum: 1900, qualifier: "registered" }),
      c({ field: "users_count", sourceType: "form", valueNum: 1100, qualifier: "paying" }),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ kind: "metric_definition", severity: "high" });
  });

  it("Talkbook-style MRR ₹2.1 L vs ₹1.9 L → value mismatch (units normalised)", () => {
    const r = findContradictions([
      c({ field: "revenue_or_mrr", sourceType: "deck", valueNum: 2.1, unit: "L" }),
      c({ field: "revenue_or_mrr", sourceType: "form", valueNum: 190000 }),
    ]);
    expect(r[0]).toMatchObject({ kind: "value_mismatch", severity: "high" });
  });

  it("Yatrika-style: 'thousands of travellers' vs ~1,300 → unquantified, high", () => {
    const r = findContradictions([
      c({ field: "customers_count", sourceType: "deck", valueText: "thousands of travellers", unquantified: true }),
      c({ field: "customers_count", sourceType: "form", valueNum: 1300 }),
    ]);
    expect(r[0]).toMatchObject({ kind: "unquantified", severity: "high" });
  });

  it("consistent documents (GrainKind/Pumpwise-style) produce nothing", () => {
    expect(
      findContradictions([
        c({ field: "repeat_or_retention", sourceType: "deck", valueNum: 38, unit: "%" }),
        c({ field: "repeat_or_retention", sourceType: "form", valueNum: 0.38 }),
        c({ field: "location", sourceType: "deck", valueText: "Pune, India" }),
        c({ field: "location", sourceType: "form", valueText: "pune india" }),
        c({ field: "revenue_or_mrr", sourceType: "deck", valueNum: 14.2, unit: "L" }),
        c({ field: "revenue_or_mrr", sourceType: "form", valueNum: 1_440_000 }), // within 5%
      ]),
    ).toEqual([]);
  });

  it("does not compare a document with itself", () => {
    expect(
      findContradictions([
        c({ field: "team_size", sourceType: "deck", valueNum: 12 }),
        c({ field: "team_size", sourceType: "deck", valueNum: 5 }),
      ]),
    ).toEqual([]);
  });

  it("severity mapping", () => {
    expect(severityFor("founder_credentials")).toBe("critical");
    expect(severityFor("capital_source")).toBe("critical");
    expect(severityFor("revenue_or_mrr")).toBe("high");
    expect(severityFor("team_size")).toBe("low");
  });
});
