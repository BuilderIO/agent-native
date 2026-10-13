import { describe, expect, it } from "vitest";

import { identityBootstrapCallbackHref } from "./auth-page-helpers.js";

describe("identityBootstrapCallbackHref", () => {
  it("uses the identity bootstrap callback when SSO is enabled", () => {
    expect(
      identityBootstrapCallbackHref("https://design.agent-native.com/thread", {
        enabled: true,
        bootstrapPath: "/design/_agent-native/identity/bootstrap",
        origin: "https://design.agent-native.com",
      }),
    ).toBe("/design/_agent-native/identity/bootstrap?return=%2Fthread");
  });

  it("returns same-app paths when SSO is disabled or unavailable", () => {
    expect(
      identityBootstrapCallbackHref("https://app.example.test/thread", {
        enabled: false,
        bootstrapPath: "/_agent-native/identity/bootstrap",
        origin: "https://app.example.test",
      }),
    ).toBe("/thread");
    expect(
      identityBootstrapCallbackHref("/thread", {
        enabled: true,
        bootstrapPath: "/_agent-native/identity/bootstrap",
        origin: "https://app.example.test",
        userAgent: "AgentNativeDesktop/1.0",
      }),
    ).toBe("/thread");
  });

  it("preserves Dispatch chat routes through the identity bootstrap", () => {
    expect(
      identityBootstrapCallbackHref(
        "https://dispatch.agent-native.com/dispatch/chat/thread-1",
        {
          enabled: true,
          bootstrapPath: "/_agent-native/identity/bootstrap",
          origin: "https://dispatch.agent-native.com",
        },
      ),
    ).toBe(
      "/_agent-native/identity/bootstrap?return=%2Fdispatch%2Fchat%2Fthread-1",
    );
  });

  it("preserves Dispatch routes without relying on the OAuth route allowlist", () => {
    expect(
      identityBootstrapCallbackHref("/dispatch/automations", {
        enabled: false,
        bootstrapPath: "/_agent-native/identity/bootstrap",
        origin: "https://dispatch.agent-native.com",
      }),
    ).toBe("/dispatch/automations");
    expect(
      identityBootstrapCallbackHref("/dispatch/automations", {
        enabled: true,
        bootstrapPath: "/_agent-native/identity/bootstrap",
        origin: "https://dispatch.agent-native.com",
      }),
    ).toBe(
      "/_agent-native/identity/bootstrap?return=%2Fdispatch%2Fautomations",
    );
  });

  it("rejects a cross-origin callback target", () => {
    expect(() =>
      identityBootstrapCallbackHref("https://outside.example.test/path", {
        enabled: false,
        bootstrapPath: "/_agent-native/identity/bootstrap",
        origin: "https://dispatch.agent-native.com",
      }),
    ).toThrow("Identity callback target must be same-origin");
  });
});
