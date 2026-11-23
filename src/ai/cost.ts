export interface ModelPrice {
  model: string;
  inputPer1mUsd: number;
  outputPer1mUsd: number;
  cachedInputPer1mUsd: number | null;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/** Cost of one call. Cached input tokens are billed at the cached rate when one is set, else the input rate. */
export function computeCost(price: ModelPrice, u: Usage, usdInr: number): { usd: number; inr: number } {
  const uncached = Math.max(0, u.inputTokens - u.cachedTokens);
  const cachedRate = price.cachedInputPer1mUsd ?? price.inputPer1mUsd;
  const usd =
    (uncached * price.inputPer1mUsd + u.cachedTokens * cachedRate + u.outputTokens * price.outputPer1mUsd) / 1_000_000;
  return { usd: round8(usd), inr: round4(usd * usdInr) };
}

export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
export const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

/** Start of "today" in IST (the fund's day), as a UTC Date — the daily limit resets at IST midnight. */
export function istDayStart(now = new Date()): Date {
  const IST_MS = 5.5 * 3600 * 1000;
  const ist = new Date(now.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS);
}
