import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { shouldAnimateDesktopAppChatSidebar } from "./DesktopAppChatShell.js";

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
  });

  it("keeps the shell open state shared while chat threads stay app-scoped", () => {
    const source = readFileSync(
      new URL("./DesktopAppChatShell.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('openStorageKey="desktop-app-chat"');
    expect(source).toContain("storageKey={`desktop-app-chat:${appId}`}");
    expect(source).toContain('position="left"');
    expect(source).toContain('agentChatSurface="desktop"');
    expect(source).not.toContain("Sign in on the right");
    expect(source).not.toContain("data-desktop-app-sign-in");
  });
});
