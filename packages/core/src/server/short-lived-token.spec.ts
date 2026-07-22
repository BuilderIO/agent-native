import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  signGatewayAccessToken,
  signRealtimeSubscribeToken,
  signShortLivedToken,
  verifyGatewayAccessToken,
  verifyRealtimeSubscribeToken,
  verifyShortLivedToken,
} from "./short-lived-token.js";

describe("short-lived-token", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    process.env.OAUTH_STATE_SECRET = "test-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
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

  it("uses derived A2A signing in production workspace deploys", () => {
    delete process.env.OAUTH_STATE_SECRET;
    delete process.env.BETTER_AUTH_SECRET;
    process.env.NODE_ENV = "production";
    process.env.AGENT_NATIVE_WORKSPACE = "1";
    process.env.A2A_SECRET = "workspace-root-secret";

    const token = signShortLivedToken({ resourceId: "rec_abc" });
    expect(verifyShortLivedToken(token, "rec_abc").ok).toBe(true);

    process.env.A2A_SECRET = "different-root-secret";
    expect(verifyShortLivedToken(token, "rec_abc")).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });
});

describe("realtime subscribe token", () => {
  const KEY_A = "project-a-hmac-secret";
  const KEY_B = "project-b-hmac-secret";

  afterEach(() => vi.useRealTimers());

  it("verifies against the same project + key and returns identity claims", () => {
    const token = signRealtimeSubscribeToken(
      { projectId: "proj_a", owner: "alice@example.com", orgId: "org-1" },
      KEY_A,
    );
    expect(
      verifyRealtimeSubscribeToken(token, { projectId: "proj_a", key: KEY_A }),
    ).toEqual({
      ok: true,
      projectId: "proj_a",
      owner: "alice@example.com",
      orgId: "org-1",
      exp: expect.any(Number),
    });
  });

  it("rejects a token for project A verified on project B's channel", () => {
    const token = signRealtimeSubscribeToken(
      { projectId: "proj_a", owner: "u@example.com" },
      KEY_A,
    );
    expect(
      verifyRealtimeSubscribeToken(token, { projectId: "proj_b", key: KEY_A }),
    ).toEqual({ ok: false, reason: "wrong_project" });
  });

  it("rejects a token signed with a different project's key", () => {
    const token = signRealtimeSubscribeToken(
      { projectId: "proj_a", owner: "u@example.com" },
      KEY_A,
    );
    expect(
      verifyRealtimeSubscribeToken(token, { projectId: "proj_a", key: KEY_B }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("does not verify as (or accept) a media token — distinct type", () => {
    const media = signShortLivedToken({ resourceId: "proj_a" });
    expect(
      verifyRealtimeSubscribeToken(media, { projectId: "proj_a", key: KEY_A }),
    ).toMatchObject({ ok: false });
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    const token = signRealtimeSubscribeToken(
      { projectId: "proj_a", owner: "u@example.com", ttlSeconds: 60 },
      KEY_A,
    );
    vi.setSystemTime(1_000_000_000_000 + 61_000);
    expect(
      verifyRealtimeSubscribeToken(token, { projectId: "proj_a", key: KEY_A }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses to sign a token with no owner/orgId identity", () => {
    expect(() =>
      signRealtimeSubscribeToken({ projectId: "proj_a" }, KEY_A),
    ).toThrow(/owner or orgId/);
    // orgId alone is sufficient.
    expect(() =>
      signRealtimeSubscribeToken(
        { projectId: "proj_a", orgId: "org-1" },
        KEY_A,
      ),
    ).not.toThrow();
  });
});

describe("gateway access-check token", () => {
  const KEY_A = "project-a-hmac-secret";
  const KEY_B = "project-b-hmac-secret";
  const claims = {
    projectId: "proj_a",
    resourceType: "document",
    resourceId: "doc-1",
    userEmail: "sharee@example.com",
    orgId: "org-1",
  };

  afterEach(() => vi.useRealTimers());

  it("round-trips the bound access query", () => {
    const token = signGatewayAccessToken(claims, KEY_A);
    expect(verifyGatewayAccessToken(token, KEY_A)).toEqual({
      ok: true,
      projectId: "proj_a",
      resourceType: "document",
      resourceId: "doc-1",
      userEmail: "sharee@example.com",
      orgId: "org-1",
    });
  });

  it("rejects a token signed with a different key", () => {
    const token = signGatewayAccessToken(claims, KEY_A);
    expect(verifyGatewayAccessToken(token, KEY_B)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects a tampered resourceId (query is signed, not just the caller)", () => {
    const token = signGatewayAccessToken(claims, KEY_A);
    const [payload, sig] = token.split(".", 2);
    const decoded = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    );
    decoded.resourceId = "doc-victim";
    const forgedPayload = Buffer.from(JSON.stringify(decoded))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
    expect(verifyGatewayAccessToken(`${forgedPayload}.${sig}`, KEY_A)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("is not interchangeable with a realtime subscribe token", () => {
    const subscribe = signRealtimeSubscribeToken(
      { projectId: "proj_a", owner: "u@example.com" },
      KEY_A,
    );
    expect(verifyGatewayAccessToken(subscribe, KEY_A)).toEqual({
      ok: false,
      reason: "wrong_type",
    });
  });

  it("rejects an expired token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000_000);
    const token = signGatewayAccessToken({ ...claims, ttlSeconds: 30 }, KEY_A);
    vi.setSystemTime(1_000_000_000_000 + 31_000);
    expect(verifyGatewayAccessToken(token, KEY_A)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
