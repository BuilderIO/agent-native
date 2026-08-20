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

describe("clips navigate action", () => {
  it("accepts the shared-with-me view", async () => {
    const result = await action.run({ view: "shared" });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "shared",
    });
    expect(result).toBe("Navigating to shared");
  });

  it("accepts the renamed dictate view", async () => {
    const result = await action.run({ view: "dictate" });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenCalledWith("navigate", {
      view: "dictate",
    });
    expect(result).toBe("Navigating to dictate");
  });

  it("carries meeting and dictation ids through to application state", async () => {
    await action.run({ view: "meeting", meetingId: "mtg_123" });
    await action.run({ view: "dictate", dictationId: "dct_456" });

    expect(mockWriteAppStateForCurrentTab).toHaveBeenNthCalledWith(
      1,
      "navigate",
      {
        view: "meeting",
        meetingId: "mtg_123",
      },
    );
    expect(mockWriteAppStateForCurrentTab).toHaveBeenNthCalledWith(
      2,
      "navigate",
      {
        view: "dictate",
        dictationId: "dct_456",
      },
    );
  });

  it("still rejects empty commands", async () => {
    await expect(action.run({})).rejects.toThrow(
      "at least --view or --path is required.",
    );

    expect(mockWriteAppStateForCurrentTab).not.toHaveBeenCalled();
  });
});
