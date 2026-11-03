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

function stubFramedUi(popup: Window | null) {
  const assign = vi.fn();
  const open = vi.fn(() => popup);
  vi.stubGlobal("window", {
    top: {},
    self: {},
    location: {
      pathname: "/settings",
      search: "",
      hash: "",
      origin: "https://app.example.com",
      href: "https://app.example.com/settings",
      assign,
    },
    open,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setInterval: vi.fn(() => 1),
    clearInterval: vi.fn(),
    __AGENT_NATIVE_CONFIG__: {},
  });
  return { assign, open };
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
    // The connection callback joins this to the server's mount itself.
    expect(hop.pathname).toBe("/_agent-native/auth/ui-return");
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

  it("preserves scoped consent options alongside a server return path", () => {
    stubUi("https://api.example.com/mail");
    const url = new URL(
      workspaceProviderOAuthUrl("gmail", {
        appId: "mail",
        requestedScopes: ["openid", "email"],
        optionalScopes: ["email"],
        targetAccountEmail: "owner@example.test",
        serverReturnPath: "/_agent-native/oauth/popup",
      }),
    );
    expect(url.searchParams.get("requestedScopes")).toBe("openid email");
    expect(url.searchParams.get("optionalScopes")).toBe("email");
    expect(url.searchParams.get("targetAccountEmail")).toBe(
      "owner@example.test",
    );
    expect(url.searchParams.get("return")).toBe("/_agent-native/oauth/popup");
  });

  it("navigates the page to the start URL", () => {
    const assign = stubUi();
    startWorkspaceProviderOAuth("google_calendar", { appId: "calendar" });
    expect(assign).toHaveBeenCalledWith(
      workspaceProviderOAuthUrl("google_calendar", { appId: "calendar" }),
    );
  });

  it("leaves the frame for a popup when embedded so providers do not refuse the frame", () => {
    const { assign, open } = stubFramedUi({ closed: false } as Window);
    startWorkspaceProviderOAuth("notion", { appId: "content-2" });
    expect(assign).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledTimes(1);
    const url = new URL(open.mock.calls[0][0] as string);
    expect(url.pathname).toBe("/_agent-native/connections/oauth/notion/start");
    expect(url.searchParams.get("appId")).toBe("content-2");
    expect(url.searchParams.get("return")).toBe(
      "/_agent-native/oauth/popup?complete=workspace-connection",
    );
  });

  it("navigates in place when a popup is blocked even while embedded", () => {
    const { assign, open } = stubFramedUi(null);
    startWorkspaceProviderOAuth("notion", { appId: "content-2" });
    expect(open).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith(
      workspaceProviderOAuthUrl("notion", { appId: "content-2" }),
    );
  });
});
