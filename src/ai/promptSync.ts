import { and, eq } from "drizzle-orm";
import type { Db } from "@/db/client";
import { promptVersions } from "@/db/schema";
import { listPromptFiles, PROMPTS_DIR } from "./prompts";

/**
 * Upsert prompt files into prompt_versions. A published version is immutable: if the body of
 * name@vN changed on disk, this throws — bump the version instead, so traces stay meaningful.
 */
export async function syncPrompts(d: Db, dir = PROMPTS_DIR) {
  const added: string[] = [];
  for (const p of listPromptFiles(dir)) {
    const [row] = await d
      .select()
      .from(promptVersions)
      .where(and(eq(promptVersions.name, p.name), eq(promptVersions.version, p.version)));
    if (row && row.sha !== p.sha)
      throw new Error(`${p.name}@v${p.version} changed after publishing — create v${p.version + 1} instead`);
    if (!row) {
      await d
        .insert(promptVersions)
        .values({ name: p.name, version: p.version, sha: p.sha, body: `${p.system}\n---user---\n${p.user}` });
      added.push(`${p.name}@v${p.version}`);
    }
  }
  return { added };
}
