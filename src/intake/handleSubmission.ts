/**
 * HTTP-level intake logic, independent of Next so it can be unit-tested.
 * Accepts either:
 *   - application/json  { payload, files: [{ kind, pathname, filename }], fax }   ← production (direct-to-Blob)
 *   - multipart/form-data payload + deck/form files + fax                         ← local dev without a Blob token
 */
import { z } from "zod";
import type { Db } from "@/db/client";
import { logger } from "@/lib/logger";
import { hitRateLimit } from "./rateLimit";
import { applicationInput, FILE_LIMITS, type IncomingFile, validateFiles } from "./schema";
import { submitApplication, type SubmitDeps } from "./submit";
import { type IncomingStore, kindOfIncomingPath, UPLOAD_KINDS } from "./uploads";

export const RATE = { limit: 5, windowMs: 60_000 };

const fileRef = z.object({
  kind: z.enum(UPLOAD_KINDS),
  pathname: z.string().max(300),
  filename: z.string().trim().min(1).max(200),
});
const jsonBody = z.object({
  payload: z.unknown(),
  files: z.array(fileRef).max(5),
  fax: z.string().optional(),
});

export interface HttpResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

export interface SubmissionDeps extends SubmitDeps {
  incoming?: IncomingStore; // required for JSON submissions
}

const bad = (error: string, issues: { path: string; message: string }[] = []): HttpResult => ({
  status: 400,
  body: { error, issues },
});

export async function handleSubmission(
  d: Db,
  req: Request,
  clientKey: string,
  deps: SubmissionDeps,
): Promise<HttpResult> {
  const rl = await hitRateLimit(d, `apply:${clientKey}`, RATE.limit, RATE.windowMs);
  if (!rl.allowed)
    return {
      status: 429,
      body: { error: "Too many submissions — try again in a minute." },
      headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) },
    };

  const isJson = (req.headers.get("content-type") ?? "").includes("application/json");
  let payload: unknown;
  let honeypot = "";
  let files: IncomingFile[] = [];
  const incomingToDelete: string[] = [];

  try {
    if (isJson) {
      const parsed = jsonBody.safeParse(await req.json().catch(() => null));
      if (!parsed.success) return bad("Malformed request");
      ({ payload } = parsed.data);
      honeypot = parsed.data.fax ?? "";
      if (honeypot) {
        incomingToDelete.push(...parsed.data.files.map((f) => f.pathname).filter((p) => kindOfIncomingPath(p)));
        return { status: 202, body: { ok: true } };
      }
      if (!deps.incoming) return { status: 503, body: { error: "Direct uploads are not configured." } };
      for (const ref of parsed.data.files) {
        // Only freshly-uploaded files may be referenced — never stored application documents.
        if (kindOfIncomingPath(ref.pathname) !== ref.kind)
          return bad("Invalid files", [{ path: "files", message: `${ref.filename}: not a valid upload reference` }]);
        incomingToDelete.push(ref.pathname);
        const got = await deps.incoming.get(ref.pathname, FILE_LIMITS[ref.kind]);
        if (!got)
          return bad("Invalid files", [
            { path: "files", message: `${ref.filename}: upload not found or expired — please re-attach it` },
          ]);
        if ("tooLarge" in got)
          return bad("Invalid files", [
            { path: "files", message: `${ref.filename}: larger than ${FILE_LIMITS[ref.kind] / 1024 / 1024} MB` },
          ]);
        files.push({ kind: ref.kind, filename: ref.filename, bytes: got.bytes });
      }
    } else {
      const fd = await req.formData();
      honeypot = String(fd.get("fax") ?? "");
      if (honeypot) return { status: 202, body: { ok: true } };
      try {
        payload = JSON.parse(String(fd.get("payload") ?? "{}"));
      } catch {
        return bad("payload must be JSON");
      }
      files = [];
      for (const kind of UPLOAD_KINDS) {
        const f = fd.get(kind);
        if (f instanceof File && f.size > 0)
          files.push({ kind, filename: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      }
    }

    const parsed = applicationInput.safeParse(payload);
    if (!parsed.success)
      return bad(
        "Invalid application",
        parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      );
    const fileErrors = validateFiles(files);
    if (fileErrors.length)
      return bad(
        "Invalid files",
        fileErrors.map((message) => ({ path: "files", message })),
      );

    const r = await submitApplication(d, parsed.data, files, { source: "form", actor: "public" }, deps);
    return { status: r.duplicate ? 200 : 201, body: { publicRef: r.publicRef, duplicate: r.duplicate } };
  } finally {
    // Temporary uploads are copied into the application's own storage (or rejected) — remove them either way.
    // Best effort: Blob's ttlDays=1 cleans up anything this misses.
    if (incomingToDelete.length && deps.incoming)
      await deps.incoming
        .del(incomingToDelete)
        .catch((e) => logger.warn({ err: (e as Error).message }, "incoming cleanup failed (ttl will remove)"));
  }
}
