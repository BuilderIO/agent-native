import { beforeEach, describe, expect, it, vi } from "vitest";

const readAppState = vi.fn();
let run: Record<string, unknown> | undefined;

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => readAppState(...args),
  writeAppState: vi.fn(),
}));
vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => run,
}));

import { readAppStateForCurrentTab } from "./_tab-state.js";

function mcpCall(
  target: { kind: "last-used"; tabId: string } | { kind: "unavailable" },
) {
  run = { browserTabTarget: { resolve: async () => target } };
}

beforeEach(() => {
  run = undefined;
  readAppState.mockReset();
  readAppState.mockImplementation(async (key: string) => ({ key }));
});

describe("Forms tab state", () => {
  it("reads no account-wide row unless asked when no tab was used recently", async () => {
    mcpCall({ kind: "unavailable" });

    await expect(readAppStateForCurrentTab("navigation")).resolves.toBeNull();
    expect(readAppState).not.toHaveBeenCalled();
    await expect(
      readAppStateForCurrentTab("navigation", { fallbackToGlobal: true }),
    ).resolves.toEqual({ key: "navigation" });
  });

  it("surfaces a failed read of the tab's row instead of reporting no state", async () => {
    mcpCall({ kind: "last-used", tabId: "tab-b" });
    readAppState.mockRejectedValueOnce(new Error("store unavailable"));

    await expect(
      readAppStateForCurrentTab("navigation", { fallbackToGlobal: false }),
    ).rejects.toThrow("store unavailable");
  });

  it("keeps reading the account-wide row for a request with no tab to look for", async () => {
    await expect(readAppStateForCurrentTab("navigation")).resolves.toEqual({
      key: "navigation",
    });
  });
});
