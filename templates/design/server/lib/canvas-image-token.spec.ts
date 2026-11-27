import { describe, expect, it } from "vitest";

import {
  canvasImageTokenExpiry,
  mintCanvasImageToken,
  verifyCanvasImageToken,
} from "./canvas-image-token.js";

const NOON = Date.UTC(2026, 5, 10, 12, 0, 0);
const MIDNIGHT = Date.UTC(2026, 5, 11, 0, 0, 0) / 1000;

function params(email: string, nowMs: number) {
  const minted = mintCanvasImageToken(email, nowMs);
  if (minted === null) throw new Error("expected a token");
  return { u: minted.subject, exp: String(minted.exp), t: minted.token };
}

describe("canvas image token", () => {
  it("expires at the next UTC midnight, or the one after when under an hour remains", () => {
    expect(canvasImageTokenExpiry(NOON)).toBe(MIDNIGHT);
    expect(canvasImageTokenExpiry(MIDNIGHT * 1000 - 30 * 60 * 1000)).toBe(
      MIDNIGHT + 86400,
    );
  });

  it("is stable within a day and never carries the email", () => {
    const a = mintCanvasImageToken("Person@Example.test", NOON);
    const b = mintCanvasImageToken("Person@Example.test", NOON + 3_600_000);
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toMatch(/person|example/i);
    expect(a?.subject).toMatch(/^[\w-]{22}$/);
  });

  it("verifies a minted token and rejects another subject's", () => {
    const mine = params("a@example.test", NOON);
    expect(verifyCanvasImageToken(mine, NOON)).toBe(true);
    const theirs = params("b@example.test", NOON);
    expect(verifyCanvasImageToken({ ...mine, u: theirs.u }, NOON)).toBe(false);
  });

  it("rejects at expiry and beyond the 48 hour horizon", () => {
    const mine = params("a@example.test", NOON);
    expect(verifyCanvasImageToken(mine, MIDNIGHT * 1000)).toBe(false);
    expect(verifyCanvasImageToken(mine, NOON - 3 * 86_400_000)).toBe(false);
  });

  it("rejects non-string params", () => {
    expect(verifyCanvasImageToken({ u: ["a"], exp: "1", t: "x" }, NOON)).toBe(
      false,
    );
  });
});
