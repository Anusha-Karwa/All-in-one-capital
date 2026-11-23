/** Hash every src/prompts/*.md and upsert into prompt_versions (run on deploy). Fails if a version's body changed. */
import { scriptDb } from "./_db";

async function main() {
  const d = await scriptDb();
  const { syncPrompts } = await import("@/ai/promptSync");
  console.log(await syncPrompts(d));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
