import { describe, expect, it } from "vitest";
import { isPublicPath } from "./publicPaths";

describe("public paths", () => {
  it.each([
    ["/apply", "GET", true],
    ["/apply/thanks", "GET", true],
    ["/privacy", "GET", true],
    ["/api/applications", "POST", true],
    ["/api/health", "GET", true],
    ["/api/uploads", "POST", true],
    ["/api/uploads", "GET", false],
    ["/", "GET", false],
    ["/memos", "GET", false],
    ["/api/applications", "GET", false],
    ["/api/applications/abc", "GET", false],
    ["/applyx", "GET", false],
  ] as const)("%s %s → %s", (p, m, ok) => expect(isPublicPath(p, m)).toBe(ok));
});
