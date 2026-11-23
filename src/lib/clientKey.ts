import { createHash } from "node:crypto";
import { env } from "@/env";
import { keyedHash } from "./crypto";

/** Rate-limit key for a request. IPs are personal data: only a (keyed, when available) hash is stored. */
export function clientKey(req: Request): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  return env().PII_ENCRYPTION_KEY ? keyedHash(ip) : createHash("sha256").update(`ip|${ip}`).digest("hex");
}
