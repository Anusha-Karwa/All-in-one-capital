/**
 * Direct-to-Blob uploads (DECISIONS D-027 fix). Vercel functions cap request bodies (~4.5 MB), so the browser
 * uploads PDFs straight to private Vercel Blob with a short-lived, narrowly-scoped client token, then submits
 * only the resulting pathnames. The server re-fetches and re-validates every file before intake.
 */
import { FILE_LIMITS } from "./schema";

export const INCOMING_PREFIX = "incoming/";
export const UPLOAD_KINDS = ["deck", "form"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];

/** incoming/<kind>/<safe-name>.pdf, optionally followed by Blob's random suffix before ".pdf". */
const PATH_RE = /^incoming\/(deck|form)\/[A-Za-z0-9._-]{1,120}\.pdf$/;

export function kindOfIncomingPath(pathname: string): UploadKind | null {
  if (pathname.includes("..") || !PATH_RE.test(pathname)) return null;
  return pathname.split("/")[1] as UploadKind;
}

/** Safe client-side pathname for a file the user picked. */
export function incomingPathFor(kind: UploadKind, filename: string): string {
  const base =
    filename
      .replace(/\.pdf$/i, "")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "file";
  return `${INCOMING_PREFIX}${kind}/${base}.pdf`;
}

export const UPLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;

/** Constraints baked into the client token — the browser cannot widen them. Throws for any other pathname. */
export function uploadTokenOptions(pathname: string, now = Date.now()) {
  const kind = kindOfIncomingPath(pathname);
  if (!kind) throw new Error("Uploads must be PDFs under incoming/deck/ or incoming/form/");
  return {
    allowedContentTypes: ["application/pdf"],
    maximumSizeInBytes: FILE_LIMITS[kind],
    addRandomSuffix: true, // unguessable pathnames: nobody can reference another applicant's upload
    validUntil: now + UPLOAD_TOKEN_TTL_MS,
    ttlDays: 1, // abandoned uploads (never submitted) delete themselves
  };
}

/** Read/delete access to uploaded-but-not-yet-submitted files. Default: private Vercel Blob. */
export interface IncomingStore {
  /** Returns null if missing. Must enforce `maxBytes` before buffering the whole file. */
  get(pathname: string, maxBytes: number): Promise<{ bytes: Uint8Array } | { tooLarge: true } | null>;
  del(pathnames: string[]): Promise<void>;
}

export function blobIncomingStore(token: string): IncomingStore {
  return {
    async get(pathname, maxBytes) {
      const { get } = await import("@vercel/blob");
      const r = await get(pathname, { access: "private", token, useCache: false });
      if (!r || r.statusCode !== 200) return null;
      if (r.blob.size > maxBytes) {
        await r.stream.cancel();
        return { tooLarge: true };
      }
      return { bytes: new Uint8Array(await new Response(r.stream).arrayBuffer()) };
    },
    async del(pathnames) {
      if (!pathnames.length) return;
      const { del } = await import("@vercel/blob");
      await del(pathnames, { token });
    },
  };
}
