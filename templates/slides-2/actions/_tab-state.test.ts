import { beforeEach, describe, expect, it, vi } from "vitest";

const { readAppState, requestContext } = vi.hoisted(() => ({
  readAppState: vi.fn(),
  requestContext: { browserTabId: "tab-1" as string | null },
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: (...args: unknown[]) => readAppState(...args),
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/server/request-context", () => ({
  getRequestRunContext: () => requestContext,
}));

import { readAppStateForCurrentTab } from "./_tab-state.js";

beforeEach(() => {
  readAppState.mockReset();
  requestContext.browserTabId = "tab-1";
});

describe("readAppStateForCurrentTab", () => {
  it("does not fall back to another tab's global state by default", async () => {
    readAppState.mockResolvedValueOnce(null);

    await expect(readAppStateForCurrentTab("navigation")).resolves.toBeNull();
    expect(readAppState).toHaveBeenCalledTimes(1);
    expect(readAppState).toHaveBeenCalledWith("slides-2:navigation:tab-1");
  });

  it("uses global state only when the caller opts into fallback", async () => {
    readAppState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ view: "list" });

    await expect(
      readAppStateForCurrentTab("navigation", { fallbackToGlobal: true }),
    ).resolves.toEqual({ view: "list" });
    expect(readAppState).toHaveBeenNthCalledWith(
      1,
      "slides-2:navigation:tab-1",
    );
    expect(readAppState).toHaveBeenNthCalledWith(2, "navigation");
  });

  it("propagates scoped read failures instead of treating them as missing", async () => {
    const failure = new Error("state store unavailable");
    readAppState.mockRejectedValueOnce(failure);

    await expect(readAppStateForCurrentTab("slides-selection")).rejects.toBe(
      failure,
    );
    expect(readAppState).toHaveBeenCalledTimes(1);
    expect(readAppState).toHaveBeenCalledWith(
      "slides-2:slides-selection:tab-1",
    );
  });

  it("reads the global key when the request has no browser tab ID", async () => {
    requestContext.browserTabId = null;
    readAppState.mockResolvedValueOnce({ view: "editor" });

    await expect(readAppStateForCurrentTab("navigation")).resolves.toEqual({
      view: "editor",
    });
    expect(readAppState).toHaveBeenCalledOnce();
    expect(readAppState).toHaveBeenCalledWith("slides-2:navigation");
  });
});
