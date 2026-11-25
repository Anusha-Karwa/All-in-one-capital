import { Inngest } from "inngest";

/** Inngest client. INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY come from the Vercel integration. */
export const inngest = new Inngest({ id: "allin-screener" });

export const EVENTS = { applicationReceived: "application/received" } as const;
