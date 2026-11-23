import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { env, MissingEnvError } from "@/env";
import { keyedHash } from "@/lib/crypto";
import { logger } from "@/lib/logger";
import { hitRateLimit } from "@/intake/rateLimit";
import { noopQueue } from "@/intake/queue";
import { applicationInput, type IncomingFile, validateFiles } from "@/intake/schema";
import { defaultStorage } from "@/intake/storage";
import { submitApplication } from "@/intake/submit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RATE = { limit: 5, windowMs: 60_000 };

function clientKey(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  // IPs are personal data: store only a (keyed, when available) hash.
  return env().PII_ENCRYPTION_KEY ? keyedHash(ip) : createHash("sha256").update(`ip|${ip}`).digest("hex");
}

/** Public application intake. multipart/form-data: payload (JSON), deck (PDF), form (PDF, optional), fax (honeypot). */
export async function POST(req: Request) {
  try {
    const { db } = await import("@/db/client");
    const d = await db();

    const rl = await hitRateLimit(d, `apply:${clientKey(req)}`, RATE.limit, RATE.windowMs);
    if (!rl.allowed)
      return NextResponse.json(
        { error: "Too many submissions — try again in a minute." },
        { status: 429, headers: { "retry-after": String(Math.ceil(rl.retryAfterMs / 1000)) } },
      );

    const fd = await req.formData();
    if (String(fd.get("fax") ?? "")) {
      logger.warn("honeypot filled — submission dropped");
      return NextResponse.json({ ok: true }, { status: 202 }); // don't tell bots they were caught
    }

    let payload: unknown;
    try {
      payload = JSON.parse(String(fd.get("payload") ?? "{}"));
    } catch {
      return NextResponse.json({ error: "payload must be JSON" }, { status: 400 });
    }
    const parsed = applicationInput.safeParse(payload);
    if (!parsed.success)
      return NextResponse.json(
        {
          error: "Invalid application",
          issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
        },
        { status: 400 },
      );

    const files: IncomingFile[] = [];
    for (const kind of ["deck", "form"] as const) {
      const f = fd.get(kind);
      if (f instanceof File && f.size > 0)
        files.push({ kind, filename: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
    }
    const fileErrors = validateFiles(files);
    if (fileErrors.length)
      return NextResponse.json(
        { error: "Invalid files", issues: fileErrors.map((message) => ({ path: "files", message })) },
        { status: 400 },
      );

    const r = await submitApplication(
      d,
      parsed.data,
      files,
      { source: "form", actor: "public" },
      { storage: defaultStorage(), queue: noopQueue },
    );
    return NextResponse.json({ publicRef: r.publicRef, duplicate: r.duplicate }, { status: r.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof MissingEnvError)
      return NextResponse.json({ error: "Intake is not configured yet." }, { status: 503 });
    logger.error({ err: (e as Error).message }, "intake failed");
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  }
}
