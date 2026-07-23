import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeAppState: vi.fn(),
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: mocks.writeAppState,
}));

import action from "./navigate";

describe("navigate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.writeAppState.mockResolvedValue(undefined);
  });

  it("requires at least a view or a path", async () => {
    await expect(action.run({})).rejects.toThrow(
      "At least --view or --path is required.",
    );
    expect(mocks.writeAppState).not.toHaveBeenCalled();
  });

  it("navigates by view and only includes provided keys", async () => {
    const result = await action.run({ view: "chat" });

    expect(result).toBe("Navigating to chat");
    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ view: "chat" }),
    );
    const callArg = mocks.writeAppState.mock.calls[0][1];
    expect(callArg.path).toBeUndefined();
    expect(callArg.threadId).toBeUndefined();
    expect(Object.keys(callArg).sort()).toEqual(["_writeId", "view"]);
  });

  it("navigates by path when view is not given", async () => {
    const result = await action.run({ path: "/settings" });

    expect(result).toBe("Navigating to /settings");
  });

  it("prefers view over path when both are given", async () => {
    const result = await action.run({ view: "chat", path: "/settings" });

    expect(result).toBe("Navigating to chat");
  });

  it("includes threadId when provided", async () => {
    await action.run({ view: "chat", threadId: "t1" });

    expect(mocks.writeAppState).toHaveBeenCalledWith(
      "navigate",
      expect.objectContaining({ view: "chat", threadId: "t1" }),
    );
  });

  it("stamps a unique _writeId on every write", async () => {
    await action.run({ view: "chat" });

    const callArg = mocks.writeAppState.mock.calls[0][1];
    expect(typeof callArg._writeId).toBe("string");
    expect(callArg._writeId.includes("-")).toBe(true);
  });
});
