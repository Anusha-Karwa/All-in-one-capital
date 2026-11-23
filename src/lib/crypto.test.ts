import { describe, expect, it } from "vitest";
import { decryptPii, encryptPii, keyedHash } from "./crypto";

const K = Buffer.alloc(32, 7).toString("base64");
const K2 = Buffer.alloc(32, 9).toString("base64");

describe("PII crypto", () => {
  it("round-trips and never stores plaintext", () => {
    const enc = encryptPii("priya@example.com", K)!;
    expect(enc).not.toContain("priya");
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptPii(enc, K)).toBe("priya@example.com");
  });
  it("uses a fresh IV each time", () => {
    expect(encryptPii("x", K)).not.toBe(encryptPii("x", K));
  });
  it("fails closed with the wrong key or tampered data", () => {
    const enc = encryptPii("secret", K)!;
    expect(() => decryptPii(enc, K2)).toThrow();
    const parts = enc.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptPii(parts.join(":"), K)).toThrow();
  });
  it("null/empty stay null", () => {
    expect(encryptPii("", K)).toBeNull();
    expect(decryptPii(null, K)).toBeNull();
  });
  it("keyed hash is stable, normalised and key-dependent", () => {
    expect(keyedHash(" LinkedIn.com/in/X ", K)).toBe(keyedHash("linkedin.com/in/x", K));
    expect(keyedHash("a", K)).not.toBe(keyedHash("a", K2));
  });
});
