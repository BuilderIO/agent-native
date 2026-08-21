import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  shouldAnimateDesktopAppChatSidebar,
  shouldShowDesktopAppChatSidebar,
} from "./DesktopAppChatShell.js";

describe("desktop app chat shell", () => {
  it("animates only the first active presentation of a cached app tab", () => {
    expect(
      shouldAnimateDesktopAppChatSidebar({
        isActive: true,
        hasSwitchedAway: false,
      }),
    ).toBe(true);
    expect(
      shouldAnimateDesktopAppChatSidebar({
        isActive: false,
        hasSwitchedAway: false,
      }),
    ).toBe(false);
    expect(
      shouldAnimateDesktopAppChatSidebar({
        isActive: true,
        hasSwitchedAway: true,
      }),
    ).toBe(false);
    expect(
      shouldAnimateDesktopAppChatSidebar({
        isActive: true,
        hasSwitchedAway: false,
        chatSidebarWasOpenBeforeMount: true,
      }),
    ).toBe(false);
  });

  it("keeps the shell open state shared while new app chats start empty", () => {
    const source = readFileSync(
      new URL("./DesktopAppChatShell.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('openStorageKey="desktop-app-chat"');
    expect(source).toContain("storageKey={`desktop-app-chat:${appId}`}");
    expect(source).toContain('position="left"');
    expect(source).toContain('agentChatSurface="desktop"');
    expect(source).toContain("restoreActiveThread={false}");
    expect(source).toContain("enabled={showChatSidebar}");
    expect(source).not.toContain(
      "{showChatSidebar ? (\n          <MemoryRouter>",
    );
    expect(source).not.toContain("Sign in on the right");
    expect(source).not.toContain("data-desktop-app-sign-in");
  });

  it("shows chat while the guest app is still loading", () => {
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "unknown",
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "checking",
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "unauthenticated",
      }),
    ).toBe(false);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "sign-in-required",
      }),
    ).toBe(false);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "signed-in",
      }),
    ).toBe(true);
    expect(
      shouldShowDesktopAppChatSidebar({
        apiUrl: "https://dispatch.example/_agent-native/agent-chat",
        appAuthState: "authenticated",
        desktopIdentityStatus: "signed-in",
        chatEnabled: false,
      }),
    ).toBe(false);
  });
});
