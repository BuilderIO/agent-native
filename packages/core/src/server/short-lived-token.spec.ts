import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  signShortLivedToken,
  verifyShortLivedToken,
} from "./short-lived-token.js";

describe("short-lived-token", () => {
  const ORIGINAL_ENV = process.env.OAUTH_STATE_SECRET;

  beforeEach(() => {
    process.env.OAUTH_STATE_SECRET = "test-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.OAUTH_STATE_SECRET;
    } else {
      process.env.OAUTH_STATE_SECRET = ORIGINAL_ENV;
    }
    vi.useRealTimers();
  });

  it("signs a token that verifies for the same resource", () => {
    const token = signShortLivedToken({ resourceId: "rec_abc" });
    const result = verifyShortLivedToken(token, "rec_abc");
    expect(result.ok).toBe(true);
  });

  it("includes viewerEmail in claims when supplied", () => {
    const token = signShortLivedToken({
      resourceId: "rec_abc",
      viewerEmail: "alice@example.com",
    });
    const result = verifyShortLivedToken(token, "rec_abc");
    expect(result).toEqual({ ok: true, viewerEmail: "alice@example.com" });
  });

  it("rejects a token signed for a different resource", () => {
    const token = signShortLivedToken({ resourceId: "rec_abc" });
    const result = verifyShortLivedToken(token, "rec_xyz");
    expect(result).toEqual({ ok: false, reason: "wrong_resource" });
  });

  it("rejects a tampered signature", () => {
    const token = signShortLivedToken({ resourceId: "rec_abc" });
    const [payload] = token.split(".");
    const tampered = `${payload}.AAAAAAAA`;
    const result = verifyShortLivedToken(tampered, "rec_abc");
    expect(result.ok).toBe(false);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = signShortLivedToken({ resourceId: "rec_abc" });
    const [, sig] = token.split(".");
    // Forge a payload claiming a different resource — old sig won't match.
    const forged =
      Buffer.from(JSON.stringify({ resourceId: "rec_xyz", exp: 9e12 }))
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "") +
      "." +
      sig;
    const result = verifyShortLivedToken(forged, "rec_xyz");
    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-30T12:00:00Z"));
    const token = signShortLivedToken({
      resourceId: "rec_abc",
      ttlSeconds: 60,
    });
    // Advance past expiry.
    vi.setSystemTime(new Date("2026-04-30T12:02:00Z"));
    const result = verifyShortLivedToken(token, "rec_abc");
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects malformed tokens", () => {
    expect(verifyShortLivedToken("", "rec_abc").ok).toBe(false);
    expect(verifyShortLivedToken("nodot", "rec_abc").ok).toBe(false);
    expect(verifyShortLivedToken("a.", "rec_abc").ok).toBe(false);
    expect(verifyShortLivedToken(".b", "rec_abc").ok).toBe(false);
  });
});
