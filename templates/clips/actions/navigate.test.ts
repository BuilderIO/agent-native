import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.fn();

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

import action from "./navigate";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("clips navigate action", () => {
  it("accepts the renamed dictate view", async () => {
    const result = await action.run({ view: "dictate" });

    expect(mockWriteAppState).toHaveBeenCalledWith("navigate", {
      view: "dictate",
    });
    expect(result).toBe("Navigating to dictate");
  });

  it("carries meeting and dictation ids through to application state", async () => {
    await action.run({ view: "meeting", meetingId: "mtg_123" });
    await action.run({ view: "dictate", dictationId: "dct_456" });

    expect(mockWriteAppState).toHaveBeenNthCalledWith(1, "navigate", {
      view: "meeting",
      meetingId: "mtg_123",
    });
    expect(mockWriteAppState).toHaveBeenNthCalledWith(2, "navigate", {
      view: "dictate",
      dictationId: "dct_456",
    });
  });

  it("still rejects empty commands", async () => {
    const result = await action.run({});

    expect(mockWriteAppState).not.toHaveBeenCalled();
    expect(result).toBe("Error: at least --view or --path is required.");
  });
});
