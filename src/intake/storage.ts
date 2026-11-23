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

export function blobStorage(token: string): DocStorage {
  return {
    async put(key, bytes) {
      const { put } = await import("@vercel/blob");
      // Decks are confidential: private store access only, read back server-side with the token.
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
  const t = env().BLOB_READ_WRITE_TOKEN;
  if (t) return blobStorage(t);
  if (env().APP_ENV === "prod") throw new Error("BLOB_READ_WRITE_TOKEN is required in prod");
  return localStorageAt();
}
