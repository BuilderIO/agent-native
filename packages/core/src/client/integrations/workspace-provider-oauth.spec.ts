import { afterEach, describe, expect, it, vi } from "vitest";

import {
  startWorkspaceProviderOAuth,
  workspaceProviderOAuthUrl,
} from "./workspace-provider-oauth.js";

function stubUi(apiBaseUrl?: string) {
  const assign = vi.fn();
  vi.stubGlobal("window", {
    location: {
      pathname: "/settings",
      search: "",
      hash: "",
      origin: "https://app.example.com",
      href: "https://app.example.com/settings",
      assign,
    },
    __AGENT_NATIVE_CONFIG__: apiBaseUrl ? { apiBaseUrl } : {},
  });
  return assign;
}

function startUrl(href: string): URL {
  return new URL(href, "https://app.example.com");
}

describe("workspaceProviderOAuthUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the provider's connection flow with the app and scope", () => {
    stubUi();
    const url = startUrl(
      workspaceProviderOAuthUrl("github", { appId: "mail" }),
    );
    expect(url.pathname).toBe("/_agent-native/connections/oauth/github/start");
    expect(url.searchParams.get("appId")).toBe("mail");
    expect(url.searchParams.get("scope")).toBe("user");
    expect(url.searchParams.has("return")).toBe(false);

    const org = startUrl(
      workspaceProviderOAuthUrl("github", {
        appId: "mail",
        scope: "organization",
      }),
    );
    expect(org.searchParams.get("scope")).toBe("organization");
  });

  it("returns to the UI page as-is when the server shares the UI origin", () => {
    stubUi();
    const url = startUrl(
      workspaceProviderOAuthUrl("github", {
        appId: "mail",
        returnPath: "/settings?tab=github",
      }),
    );
    expect(url.searchParams.get("return")).toBe("/settings?tab=github");
  });

  it("returns to the UI page through the server when it is separate", () => {
    stubUi("https://api.example.com/mail");
    const url = new URL(
      workspaceProviderOAuthUrl("github", {
        appId: "mail",
        returnPath: "/settings?tab=github",
      }),
    );
    expect(url.origin).toBe("https://api.example.com");
    const hop = new URL(url.searchParams.get("return")!, url.origin);
    expect(hop.pathname).toBe("/mail/_agent-native/auth/ui-return");
    expect(hop.searchParams.get("to")).toBe(
      "https://app.example.com/settings?tab=github",
    );
  });

  it("passes a server route through untouched", () => {
    stubUi("https://api.example.com/mail");
    const serverReturnPath =
      "/_agent-native/oauth/popup?complete=workspace-connection";
    const url = new URL(
      workspaceProviderOAuthUrl("github", {
        appId: "mail",
        returnPath: "/ignored",
        serverReturnPath,
      }),
    );
    expect(url.searchParams.get("return")).toBe(serverReturnPath);
  });

  it("navigates the page to the start URL", () => {
    const assign = stubUi();
    startWorkspaceProviderOAuth("google_calendar", { appId: "calendar" });
    expect(assign).toHaveBeenCalledWith(
      workspaceProviderOAuthUrl("google_calendar", { appId: "calendar" }),
    );
  });
});
