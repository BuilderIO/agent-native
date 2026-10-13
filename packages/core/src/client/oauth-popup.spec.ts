import { afterEach, describe, expect, it, vi } from "vitest";

import { openOAuthPopup, oauthPopupWaitingUrl } from "./oauth-popup.js";

describe("OAuth popup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("opens an HTTP waiting route instead of about:blank", () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("window", {
      location: {
        href: "http://localhost:3000/content/settings",
        pathname: "/content/settings",
      },
      open,
    });

    expect(oauthPopupWaitingUrl()).toBe(
      "http://localhost:3000/_agent-native/oauth/popup",
    );
    expect(openOAuthPopup({ features: "width=640,height=760" })).not.toBeNull();
    expect(open).toHaveBeenCalledWith(
      "http://localhost:3000/_agent-native/oauth/popup",
      "_blank",
      "width=640,height=760",
    );
  });

  it("opens a caller-provided HTTP(S) start URL directly", () => {
    const open = vi.fn(() => ({}) as Window);
    vi.stubGlobal("window", {
      location: {
        href: "https://content.example.test/settings",
        pathname: "/settings",
      },
      open,
    });

    openOAuthPopup({ initialUrl: "/_agent-native/mcp/oauth/start" });

    expect(open).toHaveBeenCalledWith(
      "https://content.example.test/_agent-native/mcp/oauth/start",
      "_blank",
      undefined,
    );
  });

  it("does not open non-HTTP(S) URLs", () => {
    const open = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://content.example.test/settings",
        pathname: "/settings",
      },
      open,
    });

    expect(openOAuthPopup({ initialUrl: "about:blank" })).toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
