/**
 * Import the seed knowledge base: 12 deal memos, 5 partner meetings, rules R1–R14, MeetRecord.
 *   npm run kb:import            # import + embed (embedding needs Gemini/Portkey keys + a model_prices row)
 *   npm run kb:import -- --no-embed
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { scriptDb } from "./_db";

function findPdf(dir: string, re: RegExp) {
  const f = readdirSync(dir).find((x) => re.test(x));
  if (!f) throw new Error(`No PDF matching ${re} in ${dir} — put the case files in /seed (see seed/README.md)`);
  return path.join(dir, f);
}

async function main() {
  const noEmbed = process.argv.includes("--no-embed");
  const d = await scriptDb();
  const { importKnowledge, embedKnowledge } = await import("@/knowledge/importKnowledge");
  const memosPath = findPdf("seed/memos", /memo.*\.pdf$/i);
  const notesPath = findPdf("seed/notes", /note.*\.pdf$/i);
  const report = await importKnowledge(d, {
    memosPdf: readFileSync(memosPath),
    notesPdf: readFileSync(notesPath),
    memosFile: path.basename(memosPath),
    notesFile: path.basename(notesPath),
  });
  console.log(JSON.stringify(report, null, 2));
  if (noEmbed) return console.log("Skipped embeddings (--no-embed).");
  const { ai } = await import("@/ai");
  const counts = await embedKnowledge(d, (texts) => ai.embed({ step: "embed_knowledge", texts }));
  console.log("Embedded:", counts);
  const { flushTraces } = await import("@/ai/tracer");
  await flushTraces();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
