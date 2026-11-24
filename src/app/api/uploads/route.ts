import {
  handleUpload,
  handleUploadPresigned,
  type HandleUploadBody,
  type HandleUploadPresignedBody,
} from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { env, MissingEnvError } from "@/env";
import { clientKey } from "@/lib/clientKey";
import { logger } from "@/lib/logger";
import { hitRateLimit } from "@/intake/rateLimit";
import { blobMode } from "@/intake/storage";
import { presignedUploadOptions, uploadTokenOptions } from "@/intake/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 2 files per application × a few retries. */
const UPLOAD_RATE = { limit: 12, windowMs: 60_000 };

/**
 * Lets the browser upload PDFs straight to private Blob storage (bypassing the serverless body limit).
 * Every grant is limited to: PDF, ≤ size limit, an incoming/{deck,form}/ path, random suffix, 10-minute validity,
 * 1-day TTL. Two modes (D-036):
 *  - "oidc"  (Storage-tab stores): signed delegation via issueSignedToken → presigned PUT URL
 *  - "token" (BLOB_READ_WRITE_TOKEN): client token via handleUpload
 */
export async function POST(req: Request) {
  const mode = blobMode();
  if (!mode) return NextResponse.json({ error: "Direct uploads are not configured." }, { status: 503 });
  try {
    const { db } = await import("@/db/client");
    const rl = await hitRateLimit(await db(), `upload:${clientKey(req)}`, UPLOAD_RATE.limit, UPLOAD_RATE.windowMs);
    if (!rl.allowed) return NextResponse.json({ error: "Too many uploads — try again in a minute." }, { status: 429 });

    const body = await req.json();
    if (mode === "oidc") {
      const { issueSignedToken } = await import("@vercel/blob");
      const result = await handleUploadPresigned({
        request: req,
        body: body as HandleUploadPresignedBody,
        // Required by the SDK even without completion callbacks; Vercel sets it when the store is connected.
        webhookPublicKey: env().BLOB_WEBHOOK_PUBLIC_KEY,
        getSignedToken: async (pathname) => {
          const o = presignedUploadOptions(pathname);
          return { token: await issueSignedToken(o.delegation), urlOptions: o.urlOptions };
        },
        // No onUploadCompleted: the submission itself re-fetches and validates each file.
      });
      return NextResponse.json(result);
    }
    const result = await handleUpload({
      token: env().BLOB_READ_WRITE_TOKEN,
      request: req,
      body: body as HandleUploadBody,
      onBeforeGenerateToken: async (pathname) => uploadTokenOptions(pathname),
    });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof MissingEnvError)
      return NextResponse.json({ error: "Uploads are not configured yet." }, { status: 503 });
    logger.warn({ err: (e as Error).message }, "upload grant refused");
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 400 });
  }
}
