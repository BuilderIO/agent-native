import { describe, expect, it } from "vitest";

import {
  buildMobileWebViewAuthUrl,
  canCaptureMobileWebViewSession,
  resolveStickyWebViewUrl,
} from "./webview-auth-url";

describe("canCaptureMobileWebViewSession", () => {
  it("never lets a WebView write the shared parent key", () => {
    expect(
      canCaptureMobileWebViewSession({
        enabled: true,
        sessionTokenKey: "parent",
        parentSessionTokenKey: "parent",
      }),
    ).toBe(false);
  });

  it("allows an app-scoped key when native capture is enabled", () => {
    expect(
      canCaptureMobileWebViewSession({
        enabled: true,
        sessionTokenKey: "clips",
        parentSessionTokenKey: "parent",
      }),
    ).toBe(true);
  });

  it("does not capture when native capture is disabled", () => {
    expect(
      canCaptureMobileWebViewSession({
        enabled: false,
        sessionTokenKey: "clips",
        parentSessionTokenKey: "parent",
      }),
    ).toBe(false);
  });
});

describe("buildMobileWebViewAuthUrl", () => {
  it("uses only the one-time embed URL for workspace apps", () => {
    const url = buildMobileWebViewAuthUrl({
      url: "https://calendar.example/events",
      workspaceAppId: "calendar",
      workspaceEmbedState: "ready",
      workspaceEmbedUrl:
        "https://calendar.example/_agent-native/embed/start?ticket=one-time",
    });

    expect(url).toContain("ticket=one-time");
    expect(url).not.toContain("parent-bearer");
  });

  it("does not fall back to the parent bearer while the workspace session is unavailable", () => {
    expect(
      buildMobileWebViewAuthUrl({
        url: "https://calendar.example/events",
        workspaceAppId: "calendar",
        workspaceEmbedState: "disabled",
      }),
    ).toBe("https://calendar.example/events");
  });

  it("does not put a separately stored token into a non-workspace URL", () => {
    expect(
      buildMobileWebViewAuthUrl({
        url: "https://clips.example/library",
      }),
    ).toBe("https://clips.example/library");
  });

  it("removes a legacy reusable session from fallback URLs", () => {
    const url = buildMobileWebViewAuthUrl({
      url: "https://mail.example/app?_session=parent-token&tab=inbox",
      workspaceAppId: "mail",
      workspaceEmbedState: "disabled",
    });

    expect(url).toBe("https://mail.example/app?tab=inbox");
    expect(url).not.toContain("parent-token");
  });
});

describe("resolveStickyWebViewUrl", () => {
  const EMBED_START =
    "https://calendar.example/_agent-native/embed/start?ticket=new";

  it("returns requestedUrl when no URL is loaded yet", () => {
    expect(
      resolveStickyWebViewUrl({
        requestedUrl: "https://calendar.example/events",
        loaded: null,
        owner: "owner-a",
        workspaceHandshakeInFlight: true,
      }),
    ).toBe("https://calendar.example/events");
  });

  it("keeps the loaded URL when a handshake is in flight and a URL is already loaded", () => {
    // Regression: switching back to a workspace-app tab must not reload it
    // just because the workspace handshake happens to be re-running.
    expect(
      resolveStickyWebViewUrl({
        requestedUrl: EMBED_START,
        loaded: { owner: "owner-a", url: "https://calendar.example/events" },
        owner: "owner-a",
        workspaceHandshakeInFlight: true,
      }),
    ).toBe("https://calendar.example/events");
  });

  it("returns requestedUrl once the handshake settles, even with a URL loaded", () => {
    expect(
      resolveStickyWebViewUrl({
        requestedUrl: EMBED_START,
        loaded: { owner: "owner-a", url: "https://calendar.example/events" },
        owner: "owner-a",
        workspaceHandshakeInFlight: false,
      }),
    ).toBe(EMBED_START);
  });

  it("never serves a document loaded for a different account", () => {
    // A newly signed-in account must not mount the previous account's page
    // while its own handshake is still pending.
    expect(
      resolveStickyWebViewUrl({
        requestedUrl: EMBED_START,
        loaded: { owner: "owner-a", url: "https://calendar.example/events" },
        owner: "owner-b",
        workspaceHandshakeInFlight: true,
      }),
    ).toBe(EMBED_START);
  });

  it("does not treat a signed-out render as owning a signed-in document", () => {
    expect(
      resolveStickyWebViewUrl({
        requestedUrl: EMBED_START,
        loaded: { owner: "owner-a", url: "https://calendar.example/events" },
        owner: null,
        workspaceHandshakeInFlight: true,
      }),
    ).toBe(EMBED_START);
  });
});
