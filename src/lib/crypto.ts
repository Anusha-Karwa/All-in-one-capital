/**
 * PII encryption at rest (§5 founders_pii, §9.4). AES-256-GCM with a random 96-bit IV per value.
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>". The version prefix allows key rotation later.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { requireEnv } from "@/env";

const VERSION = "v1";

function key(k?: string): Buffer {
  const raw = Buffer.from(k ?? requireEnv(["PII_ENCRYPTION_KEY"]).PII_ENCRYPTION_KEY, "base64");
  if (raw.length !== 32) throw new Error("PII_ENCRYPTION_KEY must be 32 bytes (base64)");
  return raw;
}

export function encryptPii(plain: string | null | undefined, k?: string): string | null {
  if (plain === null || plain === undefined || plain === "") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(k), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

export function decryptPii(enc: string | null | undefined, k?: string): string | null {
  if (!enc) return null;
  const [v, iv, tag, ct] = enc.split(":");
  if (v !== VERSION || !iv || !tag || !ct) throw new Error("Unrecognised PII ciphertext format");
  const d = createDecipheriv("aes-256-gcm", key(k), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** Keyed hash (HMAC-SHA256) for lookups/dedupe without storing the value — e.g. linkedin_url_hash, IP for rate limits. */
export function keyedHash(value: string, k?: string): string {
  return createHmac("sha256", key(k)).update(value.trim().toLowerCase()).digest("hex");
}
