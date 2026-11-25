/**
 * Self-hosted Portkey AI gateway (open source, MIT — github.com/Portkey-AI/gateway, pinned v1.15.2)
 * deployed as its own Vercel project. Portkey's hosted sign-ups are closed, so this is how every model
 * call still goes "through Portkey with automatic retries" (Case 04 Task 3). See DECISIONS D-037.
 *
 * The OSS gateway has no authentication, so this wrapper:
 *  - requires `x-gateway-secret` = GATEWAY_SECRET on every request (only the screener app knows it);
 *  - only allows the Google (Gemini) provider;
 *  - refuses `x-portkey-custom-host`, so nobody can point the gateway at arbitrary URLs.
 */
import { Hono } from "hono";
import gateway from "../vendor/src/index";

const app = new Hono();

app.get("/", (c) => c.text("ok"));

app.use("*", async (c, next) => {
  const secret = process.env.GATEWAY_SECRET;
  if (!secret || c.req.header("x-gateway-secret") !== secret) return c.json({ error: "unauthorized" }, 401);
  if (c.req.header("x-portkey-custom-host")) return c.json({ error: "custom hosts are disabled" }, 400);
  const provider = c.req.header("x-portkey-provider");
  if (provider && provider !== "google") return c.json({ error: "only the google provider is allowed" }, 400);
  if (c.req.header("x-portkey-config")?.includes("custom_host")) return c.json({ error: "custom hosts are disabled" }, 400);
  await next();
});

app.route("/", gateway);

export default app;
