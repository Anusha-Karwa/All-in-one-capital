import { MissingEnvError } from "@/env";

/** Server-page helper: turn "DB not configured" into a friendly state instead of a 500. */
export async function withDb<T>(
  fn: (d: import("@/db/client").Db) => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  try {
    const { db } = await import("@/db/client");
    return { ok: true, data: await fn(await db()) };
  } catch (e) {
    if (e instanceof MissingEnvError)
      return { ok: false, reason: `Database not configured (${e.missing.join(", ")}).` };
    throw e;
  }
}

/** Embed a search query through the AI wrapper; returns undefined (→ keyword search) when not configured or paused. */
export async function tryEmbedQuery(q: string): Promise<{ vector?: number[]; note?: string }> {
  if (!q) return {};
  try {
    const { ai } = await import("@/ai");
    const [v] = await ai.embed({ step: "kb_search", texts: [q] });
    return { vector: v };
  } catch (e) {
    return { note: `Semantic search unavailable (${(e as Error).message.slice(0, 120)}); showing keyword matches.` };
  }
}
