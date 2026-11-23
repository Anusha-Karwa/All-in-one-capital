/**
 * PII guard (§9.3). Scans outgoing prompt text before every model call.
 * Heuristic by design: false positives block a call (safe), and are visible in llm_calls as blocked_pii.
 */
export type PiiKind = "email" | "phone" | "aadhaar" | "pan";

const PATTERNS: Record<PiiKind, RegExp> = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  // +91 / 0 prefixed or bare Indian mobiles (6-9 start, 10 digits), allowing spaces/dashes; also generic +<cc> numbers
  phone: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b|\+\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/,
  aadhaar: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/,
  pan: /\b[A-Z]{5}\d{4}[A-Z]\b/,
};

export function scanPii(text: string): PiiKind[] {
  return (Object.keys(PATTERNS) as PiiKind[]).filter((k) => PATTERNS[k].test(text));
}

/** Replace detected PII with typed placeholders — used for logs/traces, never to "clean" a prompt silently. */
export function maskPii(text: string): string {
  let out = text;
  for (const [k, re] of Object.entries(PATTERNS)) out = out.replace(new RegExp(re.source, "g"), `[${k}]`);
  return out;
}
