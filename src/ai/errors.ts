/** Thrown before any model call when the system is paused or today's spend has reached the daily limit. */
export class BudgetPausedError extends Error {
  constructor(public readonly reason: string) {
    super(`LLM calls paused: ${reason}`);
    this.name = "BudgetPausedError";
  }
}

/** Thrown when an outgoing prompt contains PII on a step that must never see it (§9.3). */
export class PiiBlockedError extends Error {
  constructor(public readonly kinds: string[]) {
    super(`Prompt blocked: contains ${kinds.join(", ")}`);
    this.name = "PiiBlockedError";
  }
}

/** Thrown when a model has no row in model_prices — calls are refused so the spend limit can't be bypassed. */
export class PriceMissingError extends Error {
  constructor(public readonly model: string) {
    super(`No model_prices row for "${model}". Add one (npm run prices:set) before calling this model.`);
    this.name = "PriceMissingError";
  }
}

/** Thrown when the model output fails Zod validation after the single repair retry. */
export class LlmOutputInvalidError extends Error {
  constructor(
    public readonly promptName: string,
    public readonly issues: string,
  ) {
    super(`Invalid output from ${promptName} after repair retry: ${issues}`);
    this.name = "LlmOutputInvalidError";
  }
}
