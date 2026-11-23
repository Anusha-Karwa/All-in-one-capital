/**
 * Numeric sanity checker (BUILD_SPEC §7.5). PURE CODE — no LLM does maths here.
 *
 * The LLM only extracts formula claims as structured data; this module normalises Indian/Western units,
 * recomputes, and compares with the stated total.
 *
 *   - Formula claims (TAM/SAM/SOM, "X × Y"): ≥2× difference → `deck_arithmetic_error`.
 *     Lowers confidence in the founders' numbers; never a reject reason on its own.
 *   - Cross-checks (seats × price vs MRR, MRR × 12 vs ARR, volume × take rate vs revenue, CAC = spend ÷ customers,
 *     sum of monthly values vs stated cumulative): >10% difference → `metric_inconsistency`; ≥2× → arithmetic error.
 */

export interface Quantity {
  value: number;
  /** Free-text unit as written: "INR Cr", "₹ lakh", "L", "lakh Cr", "M", "%", "workers", "months"... */
  unit?: string | null;
}

export type CheckOp = "product" | "quotient" | "sum";
export type CheckKind = "formula" | "cross_check";

export interface FormulaClaim {
  label: string; // "TAM", "MRR = seats × price", ...
  kind: CheckKind;
  op: CheckOp;
  factors: Quantity[]; // product: all multiplied; quotient: [numerator, denominator]; sum: all added
  statedTotal: Quantity;
  source: string; // "deck p.4"
}

export type CheckOutcome = "ok" | "metric_inconsistency" | "deck_arithmetic_error" | "unparseable";

export interface CheckResult {
  claim: FormulaClaim;
  computed: number | null; // base units (rupees, count)
  stated: number | null;
  ratio: number | null; // max/min, ≥ 1
  direction: "overstated" | "understated" | "match" | null;
  outcome: CheckOutcome;
  explanation: string;
}

export const ARITHMETIC_ERROR_RATIO = 2;
export const CROSS_CHECK_TOLERANCE = 0.1;

/**
 * Multiplier for a unit string. Order matters: "lakh crore" before "crore"/"lakh".
 * Non-scale words ("workers", "INR", "months", "₹", "seats") contribute ×1.
 */
export function unitMultiplier(unit: string | null | undefined): number {
  if (!unit) return 1;
  const u = unit
    .toLowerCase()
    .replace(/[₹$]|inr|rs\.?|rupees?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\blakh\s*(cr|crore)s?\b|\bl\s*cr\b|\blcr\b/.test(u)) return 1e12;
  if (/\b(cr|crores?)\b/.test(u)) return 1e7;
  if (/\b(l|lakhs?|lacs?|lac)\b/.test(u)) return 1e5;
  if (/\b(k|thousands?)\b/.test(u)) return 1e3;
  if (/\b(m|mn|mm|millions?)\b/.test(u)) return 1e6;
  if (/\b(b|bn|billions?)\b/.test(u)) return 1e9;
  if (/\b(t|tn|trillions?)\b/.test(u)) return 1e12;
  if (/%|percent|pct/.test(u)) return 0.01;
  return 1;
}

export function toBase(q: Quantity): number {
  return q.value * unitMultiplier(q.unit);
}

/**
 * Parse a written amount such as "₹1,44,000 Cr", "14,400 Cr", "₹2.1 L", "10M", "1.8%", "₹94.5 lakh Cr".
 * Returns null if no number is present.
 */
export function parseAmount(text: string): Quantity | null {
  const m = /(-?\d[\d,]*(?:\.\d+)?)\s*(.*)$/.exec(text.trim().replace(/^[₹$]\s*/, ""));
  if (!m) return null;
  const value = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[2].trim() || null };
}

function compute(op: CheckOp, xs: number[]): number | null {
  if (!xs.length) return null;
  if (op === "product") return xs.reduce((a, b) => a * b, 1);
  if (op === "sum") return xs.reduce((a, b) => a + b, 0);
  if (xs.length !== 2 || xs[1] === 0) return null;
  return xs[0] / xs[1];
}

export function formatInr(n: number): string {
  const abs = Math.abs(n);
  const fmt = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-IN");
  if (abs >= 1e12) return `₹${fmt(n / 1e12)} lakh Cr`;
  if (abs >= 1e7) return `₹${fmt(n / 1e7)} Cr`;
  if (abs >= 1e5) return `₹${fmt(n / 1e5)} L`;
  return `₹${fmt(n)}`;
}

export function checkClaim(claim: FormulaClaim): CheckResult {
  const xs = claim.factors.map(toBase);
  const computed = xs.every(Number.isFinite) ? compute(claim.op, xs) : null;
  const stated = Number.isFinite(toBase(claim.statedTotal)) ? toBase(claim.statedTotal) : null;
  if (computed === null || stated === null || computed <= 0 || stated <= 0) {
    return {
      claim,
      computed,
      stated,
      ratio: null,
      direction: null,
      outcome: "unparseable",
      explanation: `${claim.label}: could not recompute (missing or non-positive values) — record as unverified`,
    };
  }
  const ratio = Math.max(computed, stated) / Math.min(computed, stated);
  const direction = ratio === 1 ? "match" : stated > computed ? "overstated" : "understated";
  let outcome: CheckOutcome = "ok";
  if (ratio >= ARITHMETIC_ERROR_RATIO) outcome = "deck_arithmetic_error";
  else if (claim.kind === "cross_check" && ratio - 1 > CROSS_CHECK_TOLERANCE) outcome = "metric_inconsistency";
  const opWord = claim.op === "product" ? " × " : claim.op === "sum" ? " + " : " ÷ ";
  const factorsText = claim.factors
    .map((f) => `${f.value.toLocaleString("en-IN")}${f.unit ? ` ${f.unit}` : ""}`)
    .join(opWord);
  const explanation =
    outcome === "ok"
      ? `${claim.label}: ${factorsText} = ${formatInr(computed)}; stated ${formatInr(stated)} ✓`
      : `${claim.label}: ${factorsText} = ${formatInr(computed)}, but ${claim.source} states ${formatInr(stated)} (${direction} ${ratio >= 10 ? `${Math.round(ratio)}×` : `${ratio.toFixed(2)}×`})`;
  return { claim, computed, stated, ratio, direction, outcome, explanation };
}

export function checkAll(claims: FormulaClaim[]): CheckResult[] {
  return claims.map(checkClaim);
}
