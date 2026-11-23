import { describe, expect, it, vi } from "vitest";

import {
  buildAccountMenuHandlers,
  debugInfoText,
} from "./account-menu-handlers";

/**
 * Row 593: the workspace menu's Log out and the account menu's Copy debug info
 * rendered disabled because the shell was never given handlers. These rules hold
 * without a browser.
 */
describe("account menu handlers", () => {
  it("signs out and then leaves the shell", async () => {
    const order: string[] = [];
    const handlers = buildAccountMenuHandlers({
      signOut: async () => {
        order.push("signOut");
      },
      goHome: () => order.push("goHome"),
      copyText: vi.fn(),
      debugInfo: () => "info",
    });
    await handlers.workspaceMenu.onLogout();
    expect(order).toEqual(["signOut", "goHome"]);
  });

  it("still leaves the shell when the sign-out call fails", async () => {
    const goHome = vi.fn();
    const handlers = buildAccountMenuHandlers({
      signOut: async () => {
        throw new Error("offline");
      },
      goHome,
      copyText: vi.fn(),
      debugInfo: () => "info",
    });
    await expect(handlers.workspaceMenu.onLogout()).rejects.toThrow("offline");
    expect(goHome).toHaveBeenCalledTimes(1);
  });

  it("only offers Log out all when the app can end every session", () => {
    const base = {
      signOut: () => undefined,
      goHome: () => undefined,
      copyText: () => undefined,
      debugInfo: () => "info",
    };
    expect(
      buildAccountMenuHandlers(base).workspaceMenu.onLogoutAll,
    ).toBeUndefined();
    const signOutAll = vi.fn();
    expect(
      buildAccountMenuHandlers({ ...base, signOutAll }).workspaceMenu
        .onLogoutAll,
    ).toBeTypeOf("function");
  });

  it("copies the build facts, never a credential", async () => {
    const copyText = vi.fn();
    const handlers = buildAccountMenuHandlers({
      signOut: () => undefined,
      goHome: () => undefined,
      copyText,
      debugInfo: () =>
        debugInfoText({
          appId: "analytics-2",
          buildSha: "cb3ed9eb021e",
          email: "member@example.test",
          url: "https://labs.agent-native.com/analytics-2/home",
          userAgent: "QA browser",
          now: new Date("2026-11-12T10:00:00Z"),
        }),
    });
    await handlers.accountMenu.onCopyDebugInfo();
    const copied = String(copyText.mock.calls[0]?.[0] ?? "");
    expect(copied).toContain("build: cb3ed9eb021e");
    expect(copied).toContain("app: analytics-2");
    expect(copied).toContain(
      "url: https://labs.agent-native.com/analytics-2/home",
    );
    expect(copied).toContain("at: 2026-11-12T10:00:00.000Z");
    expect(copied).not.toMatch(/token|secret|password|cookie/i);
  });

  it("marks a missing build or account as unknown instead of blank", () => {
    const text = debugInfoText({
      appId: "analytics-2",
      url: "/home",
      now: new Date("2026-11-12T10:00:00Z"),
    });
    expect(text).toContain("build: unknown");
    expect(text).toContain("account: unknown");
    expect(text).toContain("user agent: unknown");
  });
});
