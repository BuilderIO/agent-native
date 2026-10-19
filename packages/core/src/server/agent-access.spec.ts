import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildAgentAccessApiUrl,
  createScopedAgentAccessGrant,
  scopedAgentAccessResourceId,
  signScopedAgentAccessToken,
  verifyScopedAgentAccessToken,
} from "./agent-access.js";
import { signShortLivedToken } from "./short-lived-token.js";

describe("agent-access server helpers", () => {
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

  it("signs and verifies scoped agent access tokens", () => {
    const token = signScopedAgentAccessToken({
      resourceKind: "clip-agent-context",
      resourceId: "rec-1",
      viewerEmail: "viewer@example.com",
    });

    expect(
      verifyScopedAgentAccessToken(token, {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1",
      }),
    ).toEqual({ ok: true, viewerEmail: "viewer@example.com" });
  });

  it("carries a signed agent label for display", () => {
    const token = signScopedAgentAccessToken({
      resourceKind: "clip-agent-context",
      resourceId: "rec-1",
      agentLabel: "Fusion",
    });

    expect(
      verifyScopedAgentAccessToken(token, {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1",
      }),
    ).toEqual({ ok: true, viewerEmail: undefined, agentLabel: "Fusion" });
  });

  it("rejects tokens for the wrong scope", () => {
    const token = signScopedAgentAccessToken({
      resourceKind: "clip-agent-context",
      resourceId: "rec-1",
    });

    expect(
      verifyScopedAgentAccessToken(token, {
        resourceKind: "analytics-session-replay-agent-context",
        resourceId: "rec-1",
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects tokens minted by signShortLivedToken", () => {
    const legacy = signShortLivedToken({
      resourceId: scopedAgentAccessResourceId("clip-agent-context", "rec-1"),
      viewerEmail: "viewer@example.com",
    });

    expect(
      verifyScopedAgentAccessToken(legacy, {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1",
      }),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("does not put the resource id in the token", () => {
    const token = signScopedAgentAccessToken({
      resourceKind: "slides:deck",
      resourceId: "deck-CQ39871wK7EHoCOS67EE1",
    });

    const decoded = Buffer.from(token.split(".")[0], "base64url").toString(
      "utf8",
    );
    expect(decoded).not.toContain("deck-CQ39871wK7EHoCOS67EE1");
  });

  it("rejects a compact token for a different resource id", () => {
    const token = signScopedAgentAccessToken({
      resourceKind: "clip-agent-context",
      resourceId: "rec-1:access:aaaa",
    });

    expect(
      verifyScopedAgentAccessToken(token, {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1:access:bbbb",
      }).ok,
    ).toBe(false);
  });

  it("rejects an expired compact token", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));
    const token = signScopedAgentAccessToken({
      resourceKind: "clip-agent-context",
      resourceId: "rec-1",
      ttlSeconds: 60,
    });
    vi.setSystemTime(new Date("2026-07-05T12:02:00Z"));

    expect(
      verifyScopedAgentAccessToken(token, {
        resourceKind: "clip-agent-context",
        resourceId: "rec-1",
      }),
    ).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects empty, malformed and forged tokens", () => {
    const scope = { resourceKind: "clip-agent-context", resourceId: "rec-1" };
    const token = signScopedAgentAccessToken(scope);
    const [payload] = token.split(".");

    expect(verifyScopedAgentAccessToken("", scope)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyScopedAgentAccessToken("nodot", scope).ok).toBe(false);
    expect(verifyScopedAgentAccessToken(`${payload}.AAAA`, scope).ok).toBe(
      false,
    );
  });

  describe("link length", () => {
    // Anthropic's web fetch tool rejects URLs over 250 characters
    // (`url_too_long`), so a pasted agent link must stay under that.
    const LIMIT = 250;
    const email = "firstname.lastname@builder.io";

    it("keeps a slides context link under the limit", () => {
      const deckId = "deck-CQ39871wK7EHoCOS67EE1";
      const { token } = createScopedAgentAccessGrant({
        resourceKind: "slides:deck",
        resourceId: deckId,
        viewerEmail: email,
      });
      const url = buildAgentAccessApiUrl({
        endpoint: "/api/deck-agent-context.json",
        resourceId: deckId,
        origin: "https://beta.slides.agent-native.com",
        token,
      });

      expect(url.length).toBeLessThan(LIMIT);
    });

    it("keeps a password-protected clips context link under the limit", () => {
      const recordingId = "7jUwB64IFKIf";
      const { token } = createScopedAgentAccessGrant({
        resourceKind: "clip-agent-context",
        resourceId: `${recordingId}:access:${"a".repeat(64)}`,
        viewerEmail: email,
        agentLabel: "a".repeat(60),
      });
      const url = buildAgentAccessApiUrl({
        endpoint: "/api/agent-context.json",
        resourceId: recordingId,
        origin: "https://beta.clips.agent-native.com",
        token,
      });

      expect(url.length).toBeLessThan(LIMIT);
    });

    it("keeps replay event and diagnostics URLs under the limit without viewer identity claims", () => {
      const recordingId = "sr_" + "a".repeat(27);
      const { token } = createScopedAgentAccessGrant({
        resourceKind: "analytics-session-replay-agent-context",
        resourceId: recordingId,
      });
      const eventsUrl = buildAgentAccessApiUrl({
        endpoint: "/api/session-replay/agent-events.json",
        resourceId: recordingId,
        origin: "https://analytics.example.com",
        token,
        extraParams: [["limit", 10000]],
      });
      const diagnosticsUrl = buildAgentAccessApiUrl({
        endpoint: "/api/session-replay/agent-diagnostics.json",
        resourceId: recordingId,
        origin: "https://analytics.example.com",
        token,
      });

      expect(eventsUrl.length).toBeLessThan(LIMIT);
      expect(diagnosticsUrl.length).toBeLessThan(LIMIT);
      const payload = JSON.parse(
        Buffer.from(token.split(".")[0], "base64url").toString(),
      );
      expect(payload).not.toHaveProperty("v");
    });
  });

  it("returns expiry metadata for grants", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));

    const grant = createScopedAgentAccessGrant({
      resourceKind: "analytics-session-replay-agent-context",
      resourceId: "sr_1",
      ttlSeconds: 60,
    });

    expect(grant.ttlSeconds).toBe(60);
    expect(grant.expiresAt).toBe("2026-07-05T12:01:00.000Z");
    expect(
      verifyScopedAgentAccessToken(grant.token, {
        resourceKind: "analytics-session-replay-agent-context",
        resourceId: "sr_1",
      }).ok,
    ).toBe(true);
  });
});
