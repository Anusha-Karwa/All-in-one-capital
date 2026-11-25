/** Retry policy for every model call (Case 04 Task 3; §8.4 retry table): 4 attempts, exponential backoff, 429/5xx. */
export const DEFAULT_PORTKEY_CONFIG = {
  retry: { attempts: 4, on_status_codes: [429, 500, 502, 503, 504] },
  request_timeout: 90_000,
} as const;
