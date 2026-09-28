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

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.test/connect",
    "/\\evil.test/connect",
    "\\/evil.test/connect",
    "\\\\evil.test/connect",
    "\\evil.test/connect",
    "/\n/evil.test/connect",
    "/\r/evil.test/connect",
    "/\t/evil.test/connect",
    "/\n\\evil.test/connect",
    "java\nscript:alert(1)",
    "connect",
  ])("drops the unsafe connect target %s", (connectUrl) => {
    const result = connectRequiredResult({
      provider: "acme",
      providerLabel: "Acme",
      reason: "Acme is not connected.",
      connectUrl,
      settingsPath: connectUrl,
    });

    expect(result.connectRequired).not.toHaveProperty("connectUrl");
    expect(result.connectRequired).not.toHaveProperty("settingsPath");
    expect(result.connectRequired.reason).toBe("Acme is not connected.");
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

  it("strips an unsafe href that never went through the producer", () => {
    const card = normalizeConnectRequiredResult({
      connectRequired: {
        provider: "acme",
        providerLabel: "Acme",
        reason: "Acme is not connected.",
        message: "Acme is not connected. Connect Acme to continue.",
        connectUrl: "javascript:alert(1)",
        settingsPath: "//evil.test/settings",
      },
    });

    expect(card).not.toBeNull();
    expect(card).not.toHaveProperty("connectUrl");
    expect(card).not.toHaveProperty("settingsPath");
  });

  it("returns the parser-normalized href, not the raw one", () => {
    const card = normalizeConnectRequiredResult({
      connectRequired: {
        provider: "acme",
        providerLabel: "Acme",
        reason: "Acme is not connected.",
        message: "Acme is not connected. Connect Acme to continue.",
        settingsPath: "/set\ntings",
      },
    });

    expect(card?.settingsPath).toBe("/settings");
  });

  it("keeps a same-origin path and an https url", () => {
    const card = normalizeConnectRequiredResult({
      connectRequired: {
        provider: "acme",
        providerLabel: "Acme",
        reason: "Acme is not connected.",
        message: "Acme is not connected. Connect Acme to continue.",
        connectUrl: "https://example.test/connect",
        settingsPath: "/settings",
      },
    });

    expect(card?.connectUrl).toBe("https://example.test/connect");
    expect(card?.settingsPath).toBe("/settings");
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
