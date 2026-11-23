import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { databaseUrl } from "@/env";
import * as schema from "./schema";

let _db: ReturnType<typeof makeDb> | undefined;

function makeDb(url: string) {
  return drizzle(neon(url), { schema, casing: "snake_case" });
}

/** Lazily-created Drizzle client bound to the environment-appropriate Neon branch. */
export function db() {
  _db ??= makeDb(databaseUrl());
  return _db;
}

export { schema };
