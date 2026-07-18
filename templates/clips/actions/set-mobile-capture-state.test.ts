import { beforeEach, describe, expect, it, vi } from "vitest";

const mockWriteAppState = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@agent-native/core/action", () => ({
  defineAction: (options: unknown) => options,
}));

vi.mock("@agent-native/core/application-state", () => ({
  writeAppState: (...args: unknown[]) => mockWriteAppState(...args),
}));

import action, { MOBILE_CAPTURE_STATE_KEY } from "./set-mobile-capture-state";

describe("set-mobile-capture-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes and returns a privacy-safe mobile capture state", async () => {
    const input = action.schema.parse({
      view: "meeting",
      phase: "recording",
      captureId: "capture_123",
    });

    const result = await action.run(input);

    expect(result).toEqual({
      ...input,
      updatedAt: expect.any(String),
    });
    expect(mockWriteAppState).toHaveBeenCalledOnce();
    expect(mockWriteAppState).toHaveBeenCalledWith(
      MOBILE_CAPTURE_STATE_KEY,
      result,
    );
  });

  it("rejects transcript or media fields", () => {
    expect(() =>
      action.schema.parse({
        view: "dictate",
        phase: "review",
        transcript: "private words",
      }),
    ).toThrow();
    expect(() =>
      action.schema.parse({
        view: "video",
        phase: "saving",
        mediaUrl: "file:///private/capture.mp4",
      }),
    ).toThrow();
  });
});
