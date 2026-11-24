import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/env";

/** Where uploaded documents live. Vercel Blob in deployed envs; local disk for dev without a Blob token. */
export interface DocStorage {
  put(key: string, bytes: Uint8Array): Promise<{ storageKey: string; blobUrl: string | null }>;
  get(storageKey: string): Promise<Uint8Array>;
}

export function localStorageAt(root = path.join(process.cwd(), ".uploads")): DocStorage {
  return {
    async put(key, bytes) {
      const p = path.join(root, key);
      await mkdir(path.dirname(p), { recursive: true });
      await writeFile(p, bytes);
      return { storageKey: `local:${key}`, blobUrl: null };
    },
    async get(storageKey) {
      return new Uint8Array(await readFile(path.join(root, storageKey.replace(/^local:/, ""))));
    },
  };
}

/**
 * How this deployment authenticates to Vercel Blob (DECISIONS D-036):
 *  - "token": BLOB_READ_WRITE_TOKEN (older stores)
 *  - "oidc":  BLOB_STORE_ID + the Vercel runtime's OIDC token (stores connected via the Storage tab today)
 */
export type BlobMode = "token" | "oidc";
export function blobMode(): BlobMode | null {
  if (env().BLOB_READ_WRITE_TOKEN) return "token";
  if (env().BLOB_STORE_ID) return "oidc";
  return null;
}

/** Private Vercel Blob. `token` undefined → the SDK uses OIDC (VERCEL_OIDC_TOKEN + BLOB_STORE_ID). */
export function blobStorage(token?: string): DocStorage {
  return {
    async put(key, bytes) {
      const { put } = await import("@vercel/blob");
      // Decks are confidential: private store access only, read back server-side.
      const r = await put(key, Buffer.from(bytes), {
        access: "private",
        token,
        addRandomSuffix: true,
        contentType: "application/pdf",
      });
      return { storageKey: `blob:${r.pathname}`, blobUrl: r.url };
    },
    async get(storageKey) {
      const { get } = await import("@vercel/blob");
      const r = await get(storageKey.replace(/^blob:/, ""), { access: "private", token, useCache: false });
      if (!r || r.statusCode !== 200) throw new Error(`blob not found: ${storageKey}`);
      return new Uint8Array(await new Response(r.stream).arrayBuffer());
    },
  };
}

export function defaultStorage(): DocStorage {
  const mode = blobMode();
  if (mode === "token") return blobStorage(env().BLOB_READ_WRITE_TOKEN);
  if (mode === "oidc") return blobStorage();
  if (env().APP_ENV === "prod")
    throw new Error("Blob storage is required in prod (BLOB_STORE_ID or BLOB_READ_WRITE_TOKEN)");
  return localStorageAt();
}
