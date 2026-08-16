import { describe, expect, it } from "vitest";

import { buildMobileWebViewAuthUrl } from "./webview-auth-url";

describe("buildMobileWebViewAuthUrl", () => {
  it("uses only the one-time embed URL for workspace apps", () => {
    const url = buildMobileWebViewAuthUrl({
      url: "https://calendar.example/events",
      sessionToken: "parent-bearer",
      sessionTokenKey: "parent",
      parentSessionTokenKey: "parent",
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
        sessionToken: "parent-bearer",
        sessionTokenKey: "parent",
        parentSessionTokenKey: "parent",
        workspaceAppId: "calendar",
        workspaceEmbedState: "disabled",
      }),
    ).toBe("https://calendar.example/events");
  });

  it("keeps the legacy bridge for a separately stored non-workspace token", () => {
    expect(
      buildMobileWebViewAuthUrl({
        url: "https://clips.example/library",
        sessionToken: "clips-token",
        sessionTokenKey: "clips",
        parentSessionTokenKey: "parent",
      }),
    ).toBe("https://clips.example/library?_session=clips-token");
  });
});
