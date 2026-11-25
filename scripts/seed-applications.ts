/**
 * Bulk-import the seed applications: pairs <Company>_Deck.pdf + <Company>_Form.pdf from seed/applications.
 * Founder details and sector/stage come later from the form PDF (extraction step, needs model keys).
 *   npm run seed:apps                 # live rows (source=seed)
 *   npm run seed:apps -- --test --suffix=-v1   # is_test rows with a name suffix (volume tests)
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { scriptDb } from "./_db";

async function main() {
  const isTest = process.argv.includes("--test");
  const suffix = process.argv.find((a) => a.startsWith("--suffix="))?.split("=")[1] ?? "";
  const dir = "seed/applications";
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf"));
  const companies = [...new Set(files.map((f) => f.replace(/_(deck|form)\.pdf$/i, "")))].filter(
    (c) => !c.toLowerCase().endsWith(".pdf"),
  );
  if (!companies.length) throw new Error("No <Company>_Deck.pdf files in seed/applications (see seed/README.md)");

  const d = await scriptDb();
  const { submitApplication } = await import("@/intake/submit");
  const { defaultStorage } = await import("@/intake/storage");
  const { defaultQueue } = await import("@/intake/queue");
  const queue = await defaultQueue();
  const { validateFiles } = await import("@/intake/schema");
  const rows = [];
  for (const company of companies.sort()) {
    const pick = (kind: "deck" | "form") =>
      files.find((f) => f.toLowerCase() === `${company}_${kind}.pdf`.toLowerCase());
    const inc = (["deck", "form"] as const)
      .map((kind) => ({ kind, f: pick(kind) }))
      .filter((x) => x.f)
      .map(({ kind, f }) => ({ kind, filename: f!, bytes: new Uint8Array(readFileSync(path.join(dir, f!))) }));
    const errs = validateFiles(inc);
    if (errs.length) {
      rows.push({ company, result: `SKIPPED: ${errs.join("; ")}` });
      continue;
    }
    const r = await submitApplication(
      d,
      { companyName: `${company}${suffix}` },
      inc,
      { source: "seed", isTest, actor: "script:seed-applications" },
      { storage: defaultStorage(), queue },
    );
    rows.push({
      company,
      ref: r.publicRef,
      result: r.duplicate ? "already imported" : "created",
      files: inc.map((x) => x.kind).join("+"),
    });
  }
  console.table(rows);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
