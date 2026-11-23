/**
 * Add a model price row (prices are never hard-coded — look them up on the provider's pricing page).
 *   npm run prices:set -- <model-id> <input $/1M> <output $/1M> [cached input $/1M]
 *   npm run prices:set -- --list
 */
import { scriptDb } from "./_db";

async function main() {
  const d = await scriptDb();
  const { modelPrices } = await import("@/db/schema");
  const args = process.argv.slice(2);
  if (args[0] === "--list" || !args.length) {
    console.table(await d.select().from(modelPrices));
    return;
  }
  const [model, input, output, cached] = args;
  if (!model || Number.isNaN(Number(input)) || Number.isNaN(Number(output)))
    throw new Error("usage: <model> <in$/1M> <out$/1M> [cached$/1M]");
  await d
    .insert(modelPrices)
    .values({ model, inputPer1mUsd: input, outputPer1mUsd: output, cachedInputPer1mUsd: cached ?? null });
  console.log(`Price added for ${model}`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
