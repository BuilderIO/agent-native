import { describe, expect, it } from "vitest";

import {
  normalizeSubscriptionStatus,
  type SubscriptionStatus,
} from "./subscription-status";

describe("subscription status contract", () => {
  it("normalizes a live Codex subscription snapshot", () => {
    const status = normalizeSubscriptionStatus({
      schemaVersion: 1,
      providerId: "codex",
      connectionState: "connected",
      authMethod: "chatgpt",
      account: { email: "person@example.test" },
      plan: { type: "pro", label: "Pro" },
      telemetry: {
        state: "live",
        source: "codex-app-server",
        updatedAt: 1_753_000_000,
        sourceVersion: "1.2.3",
        capabilities: {
          account: true,
          plan: true,
          rateLimits: true,
          modelTierRateLimits: false,
          contextWindow: false,
          credits: true,
          liveUpdates: true,
        },
        meters: [
          {
            id: "primary",
            kind: "five-hour",
            state: "available",
            usedPercent: 22,
            windowDurationMinutes: 300,
            resetsAt: "2026-07-19T18:00:00.000Z",
          },
          {
            id: "secondary",
            kind: "weekly",
            state: "available",
            usedPercent: 48.5,
          },
        ],
        credits: {
          state: "available",
          hasCredits: true,
          unlimited: false,
          balance: "provider-defined balance",
          used: 10,
          limit: 50,
          currency: "provider-defined",
        },
      },
    });

    expect(status).toMatchObject({
      providerId: "codex",
      connectionState: "connected",
      authMethod: "chatgpt",
      plan: { type: "pro" },
      telemetry: {
        state: "live",
        source: "codex-app-server",
        updatedAt: "2025-07-20T08:26:40.000Z",
        meters: [
          { kind: "five-hour", state: "available", usedPercent: 22 },
          { kind: "weekly", state: "available", usedPercent: 48.5 },
        ],
        credits: {
          state: "available",
          hasCredits: true,
          unlimited: false,
          balance: "provider-defined balance",
          used: 10,
          limit: 50,
          currency: "provider-defined",
        },
      },
    });
    expect(JSON.parse(JSON.stringify(status))).toEqual(status);
  });

  it("preserves a reported zero while leaving unavailable meters valueless", () => {
    const status = normalizeSubscriptionStatus({
      schemaVersion: 1,
      providerId: "claude",
      connectionState: "connected",
      authMethod: "claudeai",
      telemetry: {
        state: "stale",
        source: "claude-status-line",
        updatedAt: "2026-07-19T15:00:00.000Z",
        staleAt: "2026-07-19T15:10:00.000Z",
        capabilities: {
          rateLimits: true,
          modelTierRateLimits: false,
          contextWindow: true,
        },
        meters: [
          {
            id: "five-hour",
            kind: "five-hour",
            state: "available",
            usedPercent: 0,
          },
          {
            id: "weekly",
            kind: "weekly",
            state: "unavailable",
            message: "Available after an active Claude session.",
          },
          {
            id: "opus-weekly",
            kind: "model-tier-weekly",
            modelTier: "opus",
            state: "unsupported",
          },
        ],
        contextWindow: {
          state: "available",
          usedTokens: 12_000,
          maxTokens: 200_000,
          usedPercent: 6,
        },
      },
    });

    expect(status?.telemetry.meters[0]).toMatchObject({
      state: "available",
      usedPercent: 0,
    });
    expect(status?.telemetry.meters[1]).not.toHaveProperty("usedPercent");
    expect(status?.telemetry.meters[2]).toMatchObject({
      kind: "model-tier-weekly",
      modelTier: "opus",
      state: "unsupported",
    });
    expect(status?.telemetry.capabilities).toEqual({
      account: false,
      plan: false,
      rateLimits: true,
      modelTierRateLimits: false,
      contextWindow: true,
      credits: false,
      liveUpdates: false,
    });
    expect(status?.telemetry.contextWindow).toEqual({
      state: "available",
      usedTokens: 12_000,
      maxTokens: 200_000,
      usedPercent: 6,
    });
  });

  it("degrades invalid reported values without inventing usage", () => {
    const status = normalizeSubscriptionStatus({
      schemaVersion: 1,
      providerId: "codex",
      connectionState: "connected",
      telemetry: {
        state: "live",
        source: "future-source",
        updatedAt: "yesterday",
        meters: [
          {
            kind: "five-hour",
            state: "available",
            usedPercent: Number.NaN,
            windowDurationMinutes: -1,
          },
          {
            kind: "weekly",
            state: "unavailable",
            usedPercent: 73,
          },
          { kind: "unknown", usedPercent: 10 },
        ],
        credits: {
          state: "available",
          balance: Number.POSITIVE_INFINITY,
        },
        contextWindow: {
          state: "available",
          usedTokens: -1,
          maxTokens: 0,
          usedPercent: 101,
        },
      },
    });

    expect(status?.telemetry.source).toBe("connection-only");
    expect(status?.telemetry).not.toHaveProperty("updatedAt");
    expect(status?.telemetry.meters).toEqual([
      { id: "five-hour-1", kind: "five-hour", state: "unavailable" },
      { id: "weekly-2", kind: "weekly", state: "unavailable" },
    ]);
    expect(status?.telemetry.credits).toEqual({ state: "unavailable" });
    expect(status?.telemetry.contextWindow).toEqual({
      state: "unavailable",
    });
  });

  it("models unsupported and error telemetry without requiring meters", () => {
    const unsupported: SubscriptionStatus = {
      schemaVersion: 1,
      providerId: "claude",
      connectionState: "connected",
      telemetry: {
        state: "unsupported",
        source: "connection-only",
        capabilities: {
          account: true,
          plan: true,
          rateLimits: false,
          modelTierRateLimits: false,
          contextWindow: false,
          credits: false,
          liveUpdates: false,
        },
        meters: [],
      },
    };
    const errored = normalizeSubscriptionStatus({
      ...unsupported,
      telemetry: {
        ...unsupported.telemetry,
        state: "error",
        error: { code: "PROCESS_EXIT", message: "Provider process exited." },
      },
    });

    expect(normalizeSubscriptionStatus(unsupported)).toEqual(unsupported);
    expect(errored?.telemetry).toMatchObject({
      state: "error",
      meters: [],
      error: { code: "PROCESS_EXIT", message: "Provider process exited." },
    });
  });

  it("rejects payloads outside the versioned provider contract", () => {
    expect(normalizeSubscriptionStatus(null)).toBeNull();
    expect(
      normalizeSubscriptionStatus({
        schemaVersion: 2,
        providerId: "codex",
      }),
    ).toBeNull();
    expect(
      normalizeSubscriptionStatus({
        schemaVersion: 1,
        providerId: "other",
      }),
    ).toBeNull();
  });
});
