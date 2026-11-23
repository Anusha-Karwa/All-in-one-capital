/**
 * Retry table (BUILD_SPEC §8.4). One row per tool/failure; `runWithPolicy` applies it.
 * LLM 429/5xx retries happen inside Portkey; after Portkey gives up the item goes back to `queued` (never lost).
 */
export type OnExhaust = "skip_and_flag" | "escalate" | "requeue" | "record_gap";

export interface RetryRule {
  tool: string;
  failure: string;
  transient: boolean;
  downstreamDepends: string;
  maxRetries: number;
  onExhaust: OnExhaust;
}

export const RETRY_TABLE: readonly RetryRule[] = [
  {
    tool: "send_email",
    failure: "timeout",
    transient: true,
    downstreamDepends: "no",
    maxRetries: 3,
    onExhaust: "skip_and_flag",
  },
  {
    tool: "send_email",
    failure: "bad_address",
    transient: false,
    downstreamDepends: "yes, human can fix",
    maxRetries: 0,
    onExhaust: "escalate",
  },
  {
    tool: "check_calendar",
    failure: "timeout",
    transient: true,
    downstreamDepends: "yes, no substitute mid-run",
    maxRetries: 3,
    onExhaust: "escalate",
  },
  {
    tool: "check_calendar",
    failure: "no_access",
    transient: false,
    downstreamDepends: "yes",
    maxRetries: 0,
    onExhaust: "escalate",
  },
  {
    tool: "book_meeting",
    failure: "permission_revoked",
    transient: false,
    downstreamDepends: "yes",
    maxRetries: 0,
    onExhaust: "escalate",
  },
  {
    tool: "update_log",
    failure: "db_error",
    transient: true,
    downstreamDepends: "human can supply",
    maxRetries: 3,
    onExhaust: "escalate",
  },
  {
    tool: "llm",
    failure: "rate_limited_or_5xx",
    transient: true,
    downstreamDepends: "yes",
    maxRetries: 0 /* Portkey already retried ×4 */,
    onExhaust: "requeue",
  },
  {
    tool: "fetch_page",
    failure: "blocked_login_captcha",
    transient: false,
    downstreamDepends: "no",
    maxRetries: 0,
    onExhaust: "record_gap",
  },
];

export function ruleFor(tool: string, failure: string): RetryRule {
  const r = RETRY_TABLE.find((x) => x.tool === tool && x.failure === failure);
  if (!r)
    throw new Error(
      `No retry rule for ${tool}/${failure} — add one to the table (unknown failures must not be retried blindly)`,
    );
  return r;
}

/** Exponential backoff with jitter: 1s, 2s, 4s (+0–250 ms). */
export const backoffMs = (attempt: number, rand = Math.random) => 1000 * 2 ** attempt + Math.floor(rand() * 250);

export class ToolFailure extends Error {
  constructor(
    public readonly tool: string,
    public readonly failure: string,
    message?: string,
  ) {
    super(message ?? `${tool}: ${failure}`);
    this.name = "ToolFailure";
  }
}

export type PolicyOutcome<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; action: OnExhaust; rule: RetryRule; attempts: number; error: string };

/** Run a tool call under the retry table. Permanent failures (maxRetries 0) are not retried at all. */
export async function runWithPolicy<T>(
  fn: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<PolicyOutcome<T>> {
  let attempts = 0;
  for (;;) {
    attempts++;
    try {
      return { ok: true, value: await fn(), attempts };
    } catch (e) {
      if (!(e instanceof ToolFailure)) throw e; // unknown errors propagate — never silently swallowed
      const rule = ruleFor(e.tool, e.failure);
      if (attempts > rule.maxRetries) return { ok: false, action: rule.onExhaust, rule, attempts, error: e.message };
      await sleep(backoffMs(attempts - 1));
    }
  }
}
