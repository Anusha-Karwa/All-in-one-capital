/** Run the stuck-application reconciler once (Inngest cron runs it in Phase 3+). */
import { scriptDb } from "./_db";

async function main() {
  const d = await scriptDb();
  const { reconcileStuck } = await import("@/intake/reconcile");
  console.log(await reconcileStuck(d));
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
