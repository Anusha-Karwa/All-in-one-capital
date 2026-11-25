/** Portkey's open-source gateway (gateway/vendor, aliased) — typed as just what we use. */
declare module "@portkey-gateway" {
  const app: { fetch(request: Request, env?: unknown, ctx?: unknown): Response | Promise<Response> };
  export default app;
}
