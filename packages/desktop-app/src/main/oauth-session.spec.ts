import { describe, expect, it, vi } from "vitest";

import {
  isTrustedBuilderConnectUrl,
  routeOAuthToBoundSession,
} from "./oauth-session";

describe("isTrustedBuilderConnectUrl", () => {
  it("matches loopback /_agent-native/builder/connect URLs", () => {
    expect(
      isTrustedBuilderConnectUrl(
        new URL(
          "http://localhost:8080/_agent-native/builder/connect?_an_connect=sig",
        ),
      ),
    ).toBe(true);
    expect(
      isTrustedBuilderConnectUrl(
        new URL(
          "http://127.0.0.1:3000/analytics-2/_agent-native/builder/connect",
        ),
      ),
    ).toBe(true);
  });

  it("matches same-origin hosted /_agent-native/builder/connect URLs from an embedded app", () => {
    expect(
      isTrustedBuilderConnectUrl(
        new URL(
          "https://labs.agent-native.com/analytics-2/_agent-native/builder/connect?_an_connect=sig&_an_connect_attempt=123",
        ),
        "https://labs.agent-native.com/analytics-2/settings/agent",
      ),
    ).toBe(true);
  });

  it("rejects cross-origin or source-less hosted /_agent-native/builder/connect URLs", () => {
    expect(
      isTrustedBuilderConnectUrl(
        new URL(
          "https://evil.example.com/_agent-native/builder/connect?_an_connect=sig",
        ),
        "https://labs.agent-native.com/analytics-2/settings/agent",
      ),
    ).toBe(false);
    expect(
      isTrustedBuilderConnectUrl(
        new URL(
          "https://labs.agent-native.com/analytics-2/_agent-native/builder/connect",
        ),
      ),
    ).toBe(false);
    expect(
      isTrustedBuilderConnectUrl(
        new URL("https://labs.agent-native.com/analytics-2/settings/agent"),
        "https://labs.agent-native.com/analytics-2/settings/agent",
      ),
    ).toBe(false);
  });
});

describe("routeOAuthToBoundSession", () => {
  it("uses the bootstrap cookie session for the OAuth callback", () => {
    const bootstrapSession = { id: "calendar-webview-session" };
    const openOAuthWindow = vi.fn();

    routeOAuthToBoundSession(
      "https://accounts.google.com/o/oauth2/v2/auth?state=signed-state",
      bootstrapSession,
      openOAuthWindow,
    );

    expect(openOAuthWindow).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=signed-state",
      bootstrapSession,
    );
  });
});
