import pino from "pino";

/**
 * Structured logger. Log IDs (application_id, founder_id, trace_id), never PII.
 * The redact list is a backstop, not a licence to log personal data.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: ["email", "phone", "fullName", "full_name", "*.email", "*.phone", "*.fullName", "*.full_name", "*.apiKey"],
    censor: "[redacted]",
  },
  base: { app: "allin-screener" },
});
