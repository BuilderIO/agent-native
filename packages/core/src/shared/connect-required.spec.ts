import { describe, expect, it } from "vitest";

import {
  BUILDER_CONNECT_PROVIDER,
  BUILDER_CONNECT_PROVIDER_LABEL,
  connectRequiredResult,
  normalizeConnectRequiredResult,
} from "./connect-required.js";

describe("connectRequiredResult", () => {
  it("composes a next step into the message the model reads", () => {
    const result = connectRequiredResult({
      provider: BUILDER_CONNECT_PROVIDER,
      providerLabel: BUILDER_CONNECT_PROVIDER_LABEL,
      reason: "Builder.io is not connected for this workspace.",
    });

    expect(result.connectRequired.reason).toBe(
      "Builder.io is not connected for this workspace.",
    );
    expect(result.connectRequired.message).toContain(
      "Builder.io is not connected for this workspace.",
    );
    expect(result.connectRequired.message).toContain("Connect Builder.io");
    expect(result.connectRequired.message).toContain(
      "the Connect button shown here",
    );
  });

  it("keeps an optional connect url and settings path", () => {
    const result = connectRequiredResult({
      provider: "acme",
      providerLabel: "Acme",
      reason: "Acme is not connected.",
      connectUrl: "https://example.test/connect",
      settingsPath: "/settings",
    });

    expect(result.connectRequired.connectUrl).toBe(
      "https://example.test/connect",
    );
    expect(result.connectRequired.settingsPath).toBe("/settings");
  });

  it("omits blank optional fields instead of emitting empty strings", () => {
    const result = connectRequiredResult({
      provider: "acme",
      providerLabel: "Acme",
      reason: "Acme is not connected.",
      connectUrl: "   ",
      settingsPath: null,
    });

    expect(result.connectRequired).not.toHaveProperty("connectUrl");
    expect(result.connectRequired).not.toHaveProperty("settingsPath");
  });
});

describe("normalizeConnectRequiredResult", () => {
  it("round-trips a produced card", () => {
    const produced = connectRequiredResult({
      provider: BUILDER_CONNECT_PROVIDER,
      providerLabel: BUILDER_CONNECT_PROVIDER_LABEL,
      reason: "Builder.io is not connected for this workspace.",
    });

    expect(normalizeConnectRequiredResult(produced)).toEqual(
      produced.connectRequired,
    );
  });

  it("reads a card out of a larger tool result", () => {
    const produced = connectRequiredResult({
      provider: BUILDER_CONNECT_PROVIDER,
      providerLabel: BUILDER_CONNECT_PROVIDER_LABEL,
      reason: "Builder.io is not connected for this workspace.",
    });

    expect(
      normalizeConnectRequiredResult({
        mode: "builder-unavailable",
        appId: "onboarding-requests",
        ...produced,
      })?.provider,
    ).toBe(BUILDER_CONNECT_PROVIDER);
  });

  it("rejects results that are not a connect blocker", () => {
    expect(normalizeConnectRequiredResult(null)).toBeNull();
    expect(normalizeConnectRequiredResult({ mode: "builder" })).toBeNull();
    expect(
      normalizeConnectRequiredResult({
        connectRequired: { provider: "acme", providerLabel: "Acme" },
      }),
    ).toBeNull();
  });
});
