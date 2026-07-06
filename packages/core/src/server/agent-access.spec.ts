import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createScopedAgentAccessGrant,
  signScopedAgentAccessToken,
  verifyScopedAgentAccessToken,
} from "./agent-access.js";

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
    ).toEqual({ ok: false, reason: "wrong_resource" });
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
