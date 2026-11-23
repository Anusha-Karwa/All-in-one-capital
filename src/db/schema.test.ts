import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as s from "./schema";

describe("schema", () => {
  it("keeps PII out of every table except founders_pii", () => {
    // Columns that would hold a PII value end in the PII term (email, founder_phone, ...); ids like email_draft_id do not.
    const piiLike = /(^|_)(email|phone|full_name|first_name|linkedin_url)$/i;
    const tables = Object.entries(s).filter(([, v]) => v && typeof v === "object" && "getSQL" in (v as object));
    expect(tables.length).toBeGreaterThan(20);
    for (const [name, table] of tables) {
      if (name === "foundersPii" || name === "users") continue; // users = staff allow-list, not applicants
      const cols = Object.values(getTableColumns(table as never)).map((c) => (c as { name: string }).name);
      // `_hash` columns are one-way hashes (e.g. founders.linkedin_url_hash), not PII.
      for (const c of cols.filter((c) => !c.endsWith("_hash"))) expect(piiLike.test(c), `${name}.${c}`).toBe(false);
    }
  });

  it("founders_pii stores only encrypted columns", () => {
    const cols = Object.values(getTableColumns(s.foundersPii)).map((c) => c.name);
    for (const c of cols.filter((c) => /name|email|phone|linkedin/.test(c))) expect(c).toMatch(/_enc$/);
  });

  it("status enum matches the spec's lifecycle and the reconciler's transient set", () => {
    expect(s.APPLICATION_STATUSES).toContain("needs_attention");
    for (const t of s.TRANSIENT_STATUSES) expect(s.APPLICATION_STATUSES).toContain(t);
    expect(s.TRANSIENT_STATUSES).not.toContain("scored");
  });
});
