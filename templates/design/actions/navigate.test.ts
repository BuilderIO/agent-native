import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppStateForCurrentTab = vi.fn();

vi.mock("@agent-native/core/application-state", () => ({
  writeAppStateForCurrentTab: (...args: unknown[]) =>
    mockWriteAppStateForCurrentTab(...args),
}));

import action from "./navigate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("design navigate action", () => {
  it("carries the requested editor tool into the one-shot navigation command", async () => {
    const result = await action.run({
      view: "editor",
      designId: "design-123",
      editorView: "single",
      fileId: "screen-456",
      tool: "comment",
    });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "editor",
      designId: "design-123",
      editorView: "single",
      fileId: "screen-456",
      tool: "comment",
    });
    expect(result).toContain("(comment tool)");
  });

  it("rejects an empty navigation command", async () => {
    await expect(action.run({})).rejects.toThrow(
      "At least --view or --path is required.",
    );

    expect(mockWriteAppStateForCurrentTab).not.toHaveBeenCalled();
  });
});
