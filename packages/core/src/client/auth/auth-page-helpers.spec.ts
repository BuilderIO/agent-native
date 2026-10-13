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

  it("leaves regular and desktop callbacks on their existing path", () => {
    expect(
      identityBootstrapCallbackHref("https://app.example.test/thread", {
        enabled: false,
        bootstrapPath: "/_agent-native/identity/bootstrap",
        origin: "https://app.example.test",
      }),
    ).toBe("https://app.example.test/thread");
    expect(
      identityBootstrapCallbackHref("/thread", {
        enabled: true,
        bootstrapPath: "/_agent-native/identity/bootstrap",
        origin: "https://app.example.test",
        userAgent: "AgentNativeDesktop/1.0",
      }),
    ).toBe("/thread");
  });
});
