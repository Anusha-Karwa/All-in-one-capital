import { describe, expect, it } from "vitest";
import { checkClaim, type FormulaClaim, parseAmount, toBase, unitMultiplier } from "./numericChecks";

// Verified cases from BUILD_SPEC §3.2 (eval fixtures — tests only, never in prompts).
const product = (
  label: string,
  factors: [number, string?][],
  stated: [number, string],
  kind: FormulaClaim["kind"] = "formula",
): FormulaClaim => ({
  label,
  kind,
  op: "product",
  factors: factors.map(([value, unit]) => ({ value, unit })),
  statedTotal: { value: stated[0], unit: stated[1] },
  source: "deck",
});

describe("units", () => {
  it.each([
    ["INR Cr", 1e7],
    ["₹ crore", 1e7],
    ["L", 1e5],
    ["lakh", 1e5],
    ["lakh Cr", 1e12],
    ["lakh crore", 1e12],
    ["K", 1e3],
    ["M", 1e6],
    ["million", 1e6],
    ["bn", 1e9],
    ["%", 0.01],
    ["workers", 1],
    ["INR", 1],
    [null, 1],
  ])("%s → %d", (u, m) => expect(unitMultiplier(u)).toBe(m));

  it("parses written amounts with Indian grouping", () => {
    expect(toBase(parseAmount("₹1,44,000 Cr")!)).toBe(1.44e12);
    expect(toBase(parseAmount("₹2.1 L")!)).toBeCloseTo(210_000);
    expect(toBase(parseAmount("₹94.5 lakh Cr")!)).toBeCloseTo(9.45e13);
    expect(toBase(parseAmount("1.8%")!)).toBeCloseTo(0.018);
    expect(parseAmount("thousands of travellers")).toBeNull();
  });
});

describe("§3.2 arithmetic — must be FLAGGED", () => {
  it("EarnWise TAM: 10M × ₹12,000 × 12 = ₹1,44,000 Cr, deck says ₹14,400 Cr (10× understated)", () => {
    const r = checkClaim(
      product(
        "TAM",
        [
          [10, "M workers"],
          [12000, "INR"],
          [12, "months"],
        ],
        [14400, "INR Cr"],
      ),
    );
    expect(r.outcome).toBe("deck_arithmetic_error");
    expect(r.computed).toBe(1.44e12);
    expect(r.direction).toBe("understated");
    expect(r.ratio).toBeCloseTo(10);
  });

  it("GrainKind TAM: 38M × ₹2,400 = ₹9,120 Cr, deck says ₹91,200 Cr", () => {
    const r = checkClaim(
      product(
        "TAM",
        [
          [38, "M"],
          [2400, "INR"],
        ],
        [91200, "Cr"],
      ),
    );
    expect(r.outcome).toBe("deck_arithmetic_error");
    expect(r.direction).toBe("overstated");
    expect(r.explanation).toContain("₹9,120 Cr");
  });

  it("GrainKind SAM: 6M × ₹2,400 = ₹1,440 Cr, deck says ₹14,400 Cr", () => {
    expect(
      checkClaim(
        product(
          "SAM",
          [
            [6, "M"],
            [2400, "INR"],
          ],
          [14400, "Cr"],
        ),
      ).outcome,
    ).toBe("deck_arithmetic_error");
  });

  it("Settlr TAM: 2.1M × ₹4.5 Cr = ₹94.5 lakh Cr, deck says ₹9.4 lakh Cr", () => {
    const r = checkClaim(
      product(
        "TAM",
        [
          [2.1, "M"],
          [4.5, "Cr"],
        ],
        [9.4, "lakh Cr"],
      ),
    );
    expect(r.outcome).toBe("deck_arithmetic_error");
    expect(r.computed).toBeCloseTo(9.45e13);
  });

  it("Settlr SOM: 15,000 × ₹4.5 Cr = ₹67,500 Cr, deck says ₹6,750 Cr", () => {
    expect(checkClaim(product("SOM", [[15000], [4.5, "Cr"]], [6750, "Cr"])).outcome).toBe("deck_arithmetic_error");
  });

  it("Talkbook MRR cross-check: 340 seats × ₹500 = ₹1.7 L vs stated ₹2.1 L → metric inconsistency", () => {
    const r = checkClaim(
      product(
        "MRR = seats × price",
        [
          [340, "seats"],
          [500, "INR"],
        ],
        [2.1, "L"],
        "cross_check",
      ),
    );
    expect(r.outcome).toBe("metric_inconsistency");
  });
});

describe("§3.2 arithmetic — must NOT be flagged", () => {
  it("CAPilot ARR: ₹78k × 12 = ₹9.36 L", () => {
    expect(checkClaim(product("ARR = MRR × 12", [[78, "k"], [12]], [9.36, "L"], "cross_check")).outcome).toBe("ok");
  });
  it("RentRoute gross revenue: ₹6.1 Cr × 1.8% = ₹10.98 L vs ₹11 L", () => {
    expect(
      checkClaim(
        product(
          "Revenue = volume × take rate",
          [
            [6.1, "Cr"],
            [1.8, "%"],
          ],
          [11, "L"],
          "cross_check",
        ),
      ).outcome,
    ).toBe("ok");
  });
  it("Yatrika revenue: 12% of ₹38.6 L = ₹4.63 L vs ₹4.6 L", () => {
    expect(
      checkClaim(
        product(
          "Revenue = GMV × take",
          [
            [38.6, "L"],
            [12, "%"],
          ],
          [4.6, "L"],
          "cross_check",
        ),
      ).outcome,
    ).toBe("ok");
  });
  it("Talkbook MRR via teams: 16 × ₹13,000 = ₹2.08 L vs ₹2.1 L", () => {
    expect(checkClaim(product("MRR = teams × price", [[16], [13000, "INR"]], [2.1, "L"], "cross_check")).outcome).toBe(
      "ok",
    );
  });
  it("small rounding differences on a TAM are not flagged (<2×)", () => {
    expect(checkClaim(product("TAM", [[38, "M"], [2400]], [9000, "Cr"])).outcome).toBe("ok");
  });
  // The deck figures for these are not in the spec — fill from the real decks when /seed arrives.
  it.todo("Pumpwise TAM/SAM/SOM recompute ✓ (numbers from seed deck)");
  it.todo("StockSathi market sizing recomputes ✓ (numbers from seed deck)");
  it.todo("CareCorner market sizing recomputes ✓ (numbers from seed deck)");
  it.todo("Talkbook TAM/SAM/SOM recompute ✓ (numbers from seed deck)");
});

describe("other cross-checks", () => {
  it("CAC = spend ÷ customers", () => {
    const c: FormulaClaim = {
      label: "CAC",
      kind: "cross_check",
      op: "quotient",
      factors: [{ value: 40040 }, { value: 14 }],
      statedTotal: { value: 2860 },
      source: "deck",
    };
    expect(checkClaim(c).outcome).toBe("ok");
    expect(checkClaim({ ...c, statedTotal: { value: 1900 } }).outcome).toBe("metric_inconsistency");
  });
  it("sum of monthly chart values vs stated cumulative", () => {
    const c: FormulaClaim = {
      label: "Cumulative bookings",
      kind: "cross_check",
      op: "sum",
      factors: [100, 120, 190].map((value) => ({ value })),
      statedTotal: { value: 410 },
      source: "deck",
    };
    expect(checkClaim(c).outcome).toBe("ok");
    expect(checkClaim({ ...c, statedTotal: { value: 1300 } }).outcome).toBe("deck_arithmetic_error");
  });
  it("division by zero / missing values → unparseable (named, not silently passed)", () => {
    const c: FormulaClaim = {
      label: "CAC",
      kind: "cross_check",
      op: "quotient",
      factors: [{ value: 100 }, { value: 0 }],
      statedTotal: { value: 5 },
      source: "form",
    };
    expect(checkClaim(c).outcome).toBe("unparseable");
  });
});
