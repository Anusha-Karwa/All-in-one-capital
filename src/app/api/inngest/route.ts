import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

export const runtime = "nodejs";
export const maxDuration = 60;

// Inngest calls this endpoint (requests are signed with INNGEST_SIGNING_KEY and verified by `serve`).
export const { GET, POST, PUT } = serve({ client: inngest, functions });
