import { db } from "@/db/client";
import { callModel, embed, type CallModelArgs, type EmbedArgs } from "./call";
import { pgAiStore } from "./store";
import { langfuseTracer } from "./tracer";
import { portkeyTransport } from "./transport";
import type { AiDeps } from "./types";

let deps: AiDeps | undefined;

/** Production wiring: Portkey transport, Postgres store, Langfuse tracer. */
export function defaultAiDeps(): AiDeps {
  deps ??= { transport: portkeyTransport(), store: pgAiStore(db), tracer: langfuseTracer() };
  return deps;
}

/** Test hook. */
export function setAiDeps(d: AiDeps | undefined) {
  deps = d;
}

export const ai = {
  call: <T>(args: CallModelArgs<T>, d: AiDeps = defaultAiDeps()) => callModel(args, d),
  embed: (args: EmbedArgs, d: AiDeps = defaultAiDeps()) => embed(args, d),
};

export * from "./errors";
export type { AiDeps } from "./types";
