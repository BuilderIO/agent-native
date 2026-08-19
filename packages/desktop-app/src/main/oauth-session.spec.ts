import { describe, expect, it, vi } from "vitest";

import { routeOAuthToBoundSession } from "./oauth-session";

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
