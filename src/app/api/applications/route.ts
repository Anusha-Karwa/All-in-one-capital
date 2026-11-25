import { NextResponse } from "next/server";
import { env, MissingEnvError } from "@/env";
import { clientKey } from "@/lib/clientKey";
import { logger } from "@/lib/logger";
import { handleSubmission } from "@/intake/handleSubmission";
import { defaultQueue } from "@/intake/queue";
import { blobMode, defaultStorage } from "@/intake/storage";
import { blobIncomingStore } from "@/intake/uploads";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // re-fetching two 20 MB PDFs from Blob and storing them

/**
 * Public application intake. Production: JSON with references to files the browser uploaded directly to
 * private Blob (see /api/uploads). Local dev without a Blob token: multipart form data.
 */
export async function POST(req: Request) {
  try {
    const { db } = await import("@/db/client");
    const mode = blobMode();
    const r = await handleSubmission(await db(), req, clientKey(req), {
      storage: defaultStorage(),
      queue: await defaultQueue(),
      incoming: mode ? blobIncomingStore(mode === "token" ? env().BLOB_READ_WRITE_TOKEN : undefined) : undefined,
    });
    return NextResponse.json(r.body, { status: r.status, headers: r.headers });
  } catch (e) {
    if (e instanceof MissingEnvError)
      return NextResponse.json({ error: "Intake is not configured yet." }, { status: 503 });
    logger.error({ err: (e as Error).message }, "intake failed");
    return NextResponse.json({ error: "Something went wrong — please try again." }, { status: 500 });
  }
}
