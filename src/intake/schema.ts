/**
 * Public application form (§11 /apply). PROVISIONAL field set — align with the fund's real form
 * (seed/applications/*_Form.pdf) once it is available (DECISIONS D-022).
 */
import { z } from "zod";

export const SECTORS = ["fintech", "deeptech", "consumer_tech", "consumer_brand", "other"] as const;
export const STAGES = ["idea", "pre_seed", "seed", "series_a", "later"] as const;

const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  trimmed(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const founderInput = z.object({
  fullName: trimmed(120).min(2),
  email: z.string().trim().toLowerCase().email().max(200),
  phone: optionalText(30),
  linkedinUrl: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : undefined))
    .refine((v) => !v || /^https?:\/\//.test(v), "must be a URL"),
  role: trimmed(80).min(2),
  background: optionalText(600), // non-PII career summary; PII inside is masked on intake
});

export const applicationInput = z.object({
  companyName: trimmed(120).min(2),
  website: optionalText(300),
  sector: z.enum(SECTORS),
  stage: z.enum(STAGES),
  location: optionalText(120),
  incorporated: optionalText(60),
  amountRaising: optionalText(60),
  valuation: optionalText(60),
  oneLiner: optionalText(300),
  howHeard: z.enum(["public_form", "warm_intro", "event", "other"]).default("public_form"),
  referrer: optionalText(200), // who introduced them (warm intro) — stored as source_detail
  founders: z.array(founderInput).min(1).max(6),
  consent: z.literal(true, { message: "Consent to the privacy notice is required" }),
});

export type ApplicationInput = z.infer<typeof applicationInput>;

export interface IncomingFile {
  kind: "deck" | "form" | "other";
  filename: string;
  bytes: Uint8Array;
}

export const FILE_LIMITS = { deck: 20 * 1024 * 1024, form: 10 * 1024 * 1024, other: 10 * 1024 * 1024 } as const;

export function validateFiles(files: IncomingFile[]): string[] {
  const errs: string[] = [];
  if (!files.some((f) => f.kind === "deck")) errs.push("A pitch deck (PDF) is required");
  if (files.length > 5) errs.push("At most 5 files");
  for (const f of files) {
    if (f.bytes.byteLength === 0) errs.push(`${f.filename}: empty file`);
    else if (f.bytes.byteLength > FILE_LIMITS[f.kind])
      errs.push(`${f.filename}: larger than ${FILE_LIMITS[f.kind] / 1024 / 1024} MB`);
    const magic = Buffer.from(f.bytes.subarray(0, 5)).toString("latin1");
    if (magic !== "%PDF-") errs.push(`${f.filename}: not a PDF`);
  }
  return errs;
}
