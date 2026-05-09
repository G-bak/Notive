import { describe, it, expect } from "vitest";

import { generateToken, hashToken } from "@notive/auth";

describe("token generation", () => {
  it("produces a sufficiently long URL-safe token", () => {
    const t = generateToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(/^[A-Za-z0-9_-]+$/.test(t)).toBe(true);
  });

  it("produces unique tokens", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      set.add(generateToken());
    }
    expect(set.size).toBe(100);
  });

  it("hash is deterministic and 64 hex chars (sha256)", () => {
    const t = "abc";
    const h = hashToken(t);
    expect(h).toBe(hashToken(t));
    expect(h).toHaveLength(64);
    expect(/^[0-9a-f]+$/.test(h)).toBe(true);
  });
});
