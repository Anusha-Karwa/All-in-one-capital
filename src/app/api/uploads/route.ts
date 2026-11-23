import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { env, MissingEnvError } from "@/env";
import { clientKey } from "@/lib/clientKey";
import { logger } from "@/lib/logger";
import { hitRateLimit } from "@/intake/rateLimit";
import { uploadTokenOptions } from "@/intake/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 2 files per application × a few retries. */
const UPLOAD_RATE = { limit: 12, windowMs: 60_000 };

/**
 * Issues short-lived client tokens so the browser can upload PDFs straight to private Blob storage,
 * bypassing the serverless request-size limit. The token only allows: PDF, ≤ size limit, incoming/ path,
 * random suffix, 10-minute validity, 1-day TTL.
 */
export async function POST(req: Request) {
  const token = env().BLOB_READ_WRITE_TOKEN;
  if (!token) return NextResponse.json({ error: "Direct uploads are not configured." }, { status: 503 });
  try {
    const { db } = await import("@/db/client");
    const rl = await hitRateLimit(await db(), `upload:${clientKey(req)}`, UPLOAD_RATE.limit, UPLOAD_RATE.windowMs);
    if (!rl.allowed) return NextResponse.json({ error: "Too many uploads — try again in a minute." }, { status: 429 });

    const body = (await req.json()) as HandleUploadBody;
    const result = await handleUpload({
      token,
      request: req,
      body,
      onBeforeGenerateToken: async (pathname) => uploadTokenOptions(pathname),
      // No onUploadCompleted: the submission itself re-fetches and validates each file.
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MissingEnvError)
      return NextResponse.json({ error: "Uploads are not configured yet." }, { status: 503 });
    logger.warn({ err: (e as Error).message }, "upload token refused");
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
