import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeEmbedTargetPath,
  signEmbedSessionToken,
  verifyEmbedSessionToken,
} from "./embed-session.js";

const ORIGINAL_ENV = { ...process.env };

describe("embed session tokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T12:00:00Z"));
    process.env = { ...ORIGINAL_ENV, OAUTH_STATE_SECRET: "embed-test-secret" };
    delete process.env.APP_BASE_PATH;
    delete process.env.VITE_APP_BASE_PATH;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = ORIGINAL_ENV;
  });

  it("round-trips signed owner/org claims", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      orgId: "org_123",
      targetPath: "/_agent-native/open?view=inbox",
      ttlSeconds: 60,
    });

    const verified = verifyEmbedSessionToken(token);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.claims.ownerEmail).toBe("owner@example.com");
      expect(verified.claims.orgId).toBe("org_123");
      expect(verified.claims.targetPath).toBe("/_agent-native/open?view=inbox");
    }
  });

  it("rejects tampered and expired tokens", () => {
    const token = signEmbedSessionToken({
      ownerEmail: "owner@example.com",
      targetPath: "/dashboard",
      ttlSeconds: 1,
    });
    const tampered = `${token.slice(0, -1)}x`;
    expect(verifyEmbedSessionToken(tampered).ok).toBe(false);

    vi.advanceTimersByTime(2000);
    expect(verifyEmbedSessionToken(token)).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });
});

describe("normalizeEmbedTargetPath", () => {
  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("accepts same-origin absolute URLs and strips APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/mail";
    expect(
      normalizeEmbedTargetPath(
        "https://app.example.com/mail/inbox?threadId=t1",
        "https://app.example.com",
      ),
    ).toBe("/inbox?threadId=t1");
  });

  it("rejects same-origin absolute URLs outside the current APP_BASE_PATH", () => {
    process.env.APP_BASE_PATH = "/dispatch";
    expect(
      normalizeEmbedTargetPath(
        "https://app.example.com/analytics/dashboards/q2",
        "https://app.example.com",
      ),
    ).toBeNull();
  });

  it("rejects cross-origin and unsafe relative paths", () => {
    expect(
      normalizeEmbedTargetPath(
        "https://evil.example.com/inbox",
        "https://app.example.com",
      ),
    ).toBeNull();
    expect(normalizeEmbedTargetPath("//evil.example.com")).toBeNull();
    expect(normalizeEmbedTargetPath("/http://evil.example.com")).toBeNull();
    expect(normalizeEmbedTargetPath("/foo\u0001bar")).toBeNull();
  });
});
