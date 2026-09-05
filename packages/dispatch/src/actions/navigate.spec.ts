import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppStateForCurrentTab: vi.fn(),
}));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (action: unknown) => action,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: mocks.writeAppStateForCurrentTab,
}));

import navigate from "./navigate.js";

describe("dispatch navigate", () => {
  beforeEach(() => {
    mocks.writeAppStateForCurrentTab.mockReset();
    mocks.writeAppStateForCurrentTab.mockResolvedValue(undefined);
  });

  it("writes the command to the current browser tab", async () => {
    await expect(navigate.run({ view: "overview" })).resolves.toBe(
      "Navigating to overview",
    );

    expect(mocks.writeAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "overview",
    });
  });
});
