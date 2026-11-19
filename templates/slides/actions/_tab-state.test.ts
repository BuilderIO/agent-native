import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppState = vi.fn();
const writeAppState = vi.fn();
let run: Record<string, unknown> | undefined;

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => readAppState(...args),
  writeAppState: (...args: unknown[]) => writeAppState(...args),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => run,
}));

import {
  getCurrentRequestBrowserTabId,
  getCurrentRequestStateTabId,
  readAppStateForCurrentTab,
  writeAppStateForCurrentTab,
} from "./_tab-state.js";

function mcpCall(
  target: { kind: "last-used"; tabId: string } | { kind: "unavailable" },
) {
  run = { browserTabTarget: { resolve: async () => target } };
}

beforeEach(() => {
  run = undefined;
  readAppState.mockReset();
  writeAppState.mockReset();
  readAppState.mockImplementation(async (key: string) => ({ key }));
});

describe("Slides tab state", () => {
  it("reads and writes the last-used tab's rows for an MCP call", async () => {
    mcpCall({ kind: "last-used", tabId: "tab-b" });

    await expect(
      readAppStateForCurrentTab("slides-selection", {
        fallbackToGlobal: false,
      }),
    ).resolves.toEqual({ key: "slides-selection:tab-b" });
    await writeAppStateForCurrentTab("navigate", { deckId: "d" });

    expect(writeAppState).toHaveBeenCalledWith("navigate:tab-b", {
      deckId: "d",
    });
    expect(getCurrentRequestBrowserTabId()).toBeNull();
    await expect(getCurrentRequestStateTabId()).resolves.toBe("tab-b");
  });

  it("reads no account-wide row unless asked when no tab was used recently", async () => {
    mcpCall({ kind: "unavailable" });

    await expect(readAppStateForCurrentTab("navigation")).resolves.toBeNull();
    await expect(
      readAppStateForCurrentTab("slides-selection", {
        fallbackToGlobal: false,
      }),
    ).resolves.toBeNull();
    expect(readAppState).not.toHaveBeenCalled();
    await expect(
      readAppStateForCurrentTab("slides-selection", { fallbackToGlobal: true }),
    ).resolves.toEqual({ key: "slides-selection" });
    await expect(getCurrentRequestStateTabId()).resolves.toBeNull();
  });

  it("surfaces a failed read of the tab's row instead of reporting no state", async () => {
    mcpCall({ kind: "last-used", tabId: "tab-b" });
    readAppState.mockRejectedValueOnce(new Error("store unavailable"));

    await expect(
      readAppStateForCurrentTab("slides-selection", {
        fallbackToGlobal: false,
      }),
    ).rejects.toThrow("store unavailable");
  });

  it("keeps reading the account-wide row for a request with no tab to look for", async () => {
    await expect(
      readAppStateForCurrentTab("slides-selection", {
        fallbackToGlobal: false,
      }),
    ).resolves.toEqual({ key: "slides-selection" });
  });
});
