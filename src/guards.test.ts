/** Structural guards for "never" rules in CLAUDE.md. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const fixtures = JSON.parse(readFileSync("evals/fixtures/applicant_expectations.json", "utf8")) as {
  applicants: { company: string }[];
};
const APPLICANTS = fixtures.applicants.map((a) => a.company);

describe("guards", () => {
  it("fixtures list all 10 seed applicants", () => {
    expect(APPLICANTS.sort()).toEqual([
      "CAPilot",
      "CareCorner",
      "EarnWise",
      "GrainKind",
      "Pumpwise",
      "RentRoute",
      "Settlr",
      "StockSathi",
      "Talkbook",
      "Yatrika",
    ]);
  });

  it("no production source file imports eval fixtures", () => {
    const prod = walk("src").filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));
    for (const f of prod) expect(readFileSync(f, "utf8"), f).not.toMatch(/evals\/fixtures|applicant_expectations/);
  });

  it("no prompt file mentions a seed applicant (§3.2 findings must never reach a production prompt)", () => {
    const prompts = walk("src/prompts").filter((f) => f.endsWith(".md"));
    for (const f of prompts)
      for (const a of APPLICANTS) expect(readFileSync(f, "utf8"), `${f} mentions ${a}`).not.toContain(a);
  });
});
