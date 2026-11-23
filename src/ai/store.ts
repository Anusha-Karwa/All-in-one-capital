import { and, eq, gte, lte, desc, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { llmCalls, llmResponseCache, modelPrices, settings } from "@/db/schema";
import { env } from "@/env";
import { istDayStart } from "./cost";
import type { AiStore } from "./types";

/** Postgres-backed AiStore. Settings row id=1 is created on first use from env defaults. */
export function pgAiStore(getDb: () => Promise<Db>): AiStore {
  async function settingsRow(d: Db) {
    const [row] = await d.select().from(settings).where(eq(settings.id, 1));
    if (row) return row;
    await d
      .insert(settings)
      .values({ id: 1, dailyLimitInr: String(env().DAILY_LIMIT_INR), testMode: env().TEST_MODE })
      .onConflictDoNothing();
    const [created] = await d.select().from(settings).where(eq(settings.id, 1));
    return created;
  }

  return {
    async budget() {
      const d = await getDb();
      const s = await settingsRow(d);
      const [{ spent }] = await d
        .select({ spent: sql<string>`coalesce(sum(${llmCalls.costInr}), 0)` })
        .from(llmCalls)
        .where(gte(llmCalls.createdAt, istDayStart()));
      return {
        paused: s.paused,
        pauseReason: s.pauseReason,
        dailyLimitInr: Number(s.dailyLimitInr),
        spentTodayInr: Number(spent),
        usdInr: Number(s.usdInrRate),
      };
    },
    async pause(reason) {
      const d = await getDb();
      await settingsRow(d);
      await d.update(settings).set({ paused: true, pauseReason: reason }).where(eq(settings.id, 1));
    },
    async price(model) {
      const d = await getDb();
      const [p] = await d
        .select()
        .from(modelPrices)
        .where(and(eq(modelPrices.model, model), lte(modelPrices.effectiveFrom, new Date())))
        .orderBy(desc(modelPrices.effectiveFrom))
        .limit(1);
      if (!p) return null;
      return {
        model: p.model,
        inputPer1mUsd: Number(p.inputPer1mUsd),
        outputPer1mUsd: Number(p.outputPer1mUsd),
        cachedInputPer1mUsd: p.cachedInputPer1mUsd === null ? null : Number(p.cachedInputPer1mUsd),
      };
    },
    async cacheGet(key) {
      const d = await getDb();
      const [row] = await d.select().from(llmResponseCache).where(eq(llmResponseCache.cacheKey, key));
      return row?.output;
    },
    async cacheSet(key, output) {
      const d = await getDb();
      await d
        .insert(llmResponseCache)
        .values({ cacheKey: key, output: output as object })
        .onConflictDoNothing();
    },
    async recordCall(r) {
      const d = await getDb();
      await d.insert(llmCalls).values({
        ...r,
        costInr: String(r.costInr),
        costUsd: String(r.costUsd),
      });
    },
  };
}
