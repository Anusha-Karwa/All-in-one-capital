/**
 * Generic deck-vs-form (and web) consistency checker (BUILD_SPEC §3.2 "Required behaviour").
 *
 * Code decides numeric and definition conflicts. Textual conflicts (credentials, source of capital/credit,
 * locations) are flagged here whenever the normalised texts differ — `status: "unjudged"` — and the LLM
 * `consistency_check` step may later CONFIRM them or mark them `judged_consistent` (downgraded to low, never
 * deleted). A false alarm is preferred to a missed contradiction (kill criteria 3 and 11).
 */
import { toBase } from "./numericChecks";

export type Qualifier = "gross" | "net" | "paying" | "registered" | "trial" | "active" | "target" | "actual";

export interface ConsistencyClaim {
  id: string;
  field: string;
  sourceType: "deck" | "form" | "web" | "search";
  sourceRef: string;
  quote?: string | null;
  valueNum?: number | null;
  unit?: string | null;
  valueText?: string | null;
  qualifier?: Qualifier | null;
  /** Vague claim with no checkable number: "thousands of travellers", "3x growth", "many 5-star reviews". */
  unquantified?: boolean;
}

export type ContradictionKind = "value_mismatch" | "metric_definition" | "unquantified" | "text_mismatch";
export type Severity = "critical" | "high" | "low";

export interface FoundContradiction {
  field: string;
  kind: ContradictionKind;
  severity: Severity;
  claimAId: string;
  claimBId: string;
  explanation: string;
  status: "confirmed_by_code" | "unjudged";
}

export const VALUE_TOLERANCE = 0.05;

/** Kill criteria 3 & 11: credentials and source of capital/credit are critical; customer counts and revenue high. */
export function severityFor(field: string): Severity {
  const f = field.toLowerCase();
  if (
    /credential|education|employer|founder_background|prior_role|capital_source|credit_source|funding_source|risk_bearer|first_loss/.test(
      f,
    )
  )
    return "critical";
  if (/customer|client|user|seller|retailer|store|traveller|booking|revenue|mrr|arr|gmv|paying/.test(f)) return "high";
  return "low";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%.]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const num = (c: ConsistencyClaim) =>
  typeof c.valueNum === "number" && Number.isFinite(c.valueNum) ? toBase({ value: c.valueNum, unit: c.unit }) : null;

const close = (a: number, b: number) => Math.abs(a - b) <= VALUE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));

const label = (c: ConsistencyClaim) => `${c.sourceType} (${c.sourceRef})${c.qualifier ? ` [${c.qualifier}]` : ""}`;
const show = (c: ConsistencyClaim) =>
  c.quote
    ? `“${c.quote}”`
    : c.valueNum != null
      ? `${c.valueNum}${c.unit ? ` ${c.unit}` : ""}`
      : `“${c.valueText ?? ""}”`;

/** Compare every claim from one source against every claim from another source, field by field. */
export function findContradictions(claims: ConsistencyClaim[]): FoundContradiction[] {
  const out: FoundContradiction[] = [];
  const seen = new Set<string>();
  const push = (c: FoundContradiction) => {
    const k = [c.field, c.kind, ...[c.claimAId, c.claimBId].sort()].join("|");
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  };

  const byField = new Map<string, ConsistencyClaim[]>();
  for (const c of claims) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);

  for (const [field, cs] of byField) {
    const severity = severityFor(field);
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const [a, b] = [cs[i], cs[j]];
        if (a.sourceType === b.sourceType) continue; // within-document consistency is not this checker's job
        const other = (side: ConsistencyClaim) => cs.filter((x) => x.sourceType === side.sourceType);

        // 1. vague claim on one side, a number on the other
        if ((a.unquantified && num(b) !== null) || (b.unquantified && num(a) !== null)) {
          const [vague, exact] = a.unquantified ? [a, b] : [b, a];
          push({
            field,
            kind: "unquantified",
            severity: severity === "low" ? "low" : "high",
            claimAId: vague.id,
            claimBId: exact.id,
            status: "confirmed_by_code",
            explanation: `${label(vague)} says ${show(vague)} (unquantified, unverified — must not raise the score); ${label(exact)} gives ${show(exact)}.`,
          });
          continue;
        }

        const na = num(a);
        const nb = num(b);
        if (na !== null && nb !== null) {
          const qa = a.qualifier ?? null;
          const qb = b.qualifier ?? null;
          if (qa && qb && qa !== qb) {
            // Differently-defined metrics are only comparable when they share a number (same figure, different label).
            if (close(na, nb))
              push({
                field,
                kind: "metric_definition",
                severity,
                claimAId: a.id,
                claimBId: b.id,
                status: "confirmed_by_code",
                explanation: `Same figure labelled differently: ${label(a)} ${show(a)} vs ${label(b)} ${show(b)}.`,
              });
            continue;
          }
          if (close(na, nb)) continue;
          // Unqualified vs qualified mismatch: does the unqualified number match a differently-qualified claim on the other side?
          const [unq, q] = !qa && qb ? [a, b] : qa && !qb ? [b, a] : [null, null];
          if (unq && q) {
            const twin = other(q).find(
              (x) =>
                x.id !== q.id &&
                x.qualifier &&
                x.qualifier !== q.qualifier &&
                num(x) !== null &&
                close(num(x)!, num(unq)!),
            );
            if (twin) {
              push({
                field,
                kind: "metric_definition",
                severity,
                claimAId: unq.id,
                claimBId: twin.id,
                status: "confirmed_by_code",
                explanation: `${label(unq)} ${show(unq)} is the ${twin.qualifier} figure per ${label(twin)}; the ${q.qualifier} figure is ${show(q)}.`,
              });
              continue;
            }
          }
          push({
            field,
            kind: "value_mismatch",
            severity,
            claimAId: a.id,
            claimBId: b.id,
            status: "confirmed_by_code",
            explanation: `${label(a)} ${show(a)} vs ${label(b)} ${show(b)}.`,
          });
          continue;
        }

        // 2. text claims: differ after normalisation → flag (unjudged); identical → fine
        if (a.valueText && b.valueText && na === null && nb === null && norm(a.valueText) !== norm(b.valueText)) {
          push({
            field,
            kind: "text_mismatch",
            severity,
            claimAId: a.id,
            claimBId: b.id,
            status: "unjudged",
            explanation: `${label(a)} ${show(a)} vs ${label(b)} ${show(b)} — differs; pending consistency judge (kept flagged unless judged consistent).`,
          });
        }
      }
    }
  }
  const rank = { critical: 0, high: 1, low: 2 } as const;
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
