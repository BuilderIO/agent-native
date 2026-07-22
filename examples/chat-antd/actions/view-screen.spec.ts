import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  readAppState: mocks.readAppState,
}));

import action from "./view-screen";

describe("view-screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the current navigation state when present", async () => {
    mocks.readAppState.mockResolvedValue({ view: "chat", threadId: "t1" });

    const result = await action.run({});

    expect(mocks.readAppState).toHaveBeenCalledWith("navigation");
    expect(result).toEqual({
      navigation: { view: "chat", threadId: "t1" },
    });
  });

  it("returns a fallback message when there is no navigation state", async () => {
    mocks.readAppState.mockResolvedValue(null);

    const result = await action.run({});

    expect(result).toBe("No application state found. Is the app running?");
  });

  it("is marked read-only", () => {
    expect(action.readOnly).toBe(true);
  });
});
