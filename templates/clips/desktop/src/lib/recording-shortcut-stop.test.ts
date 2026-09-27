import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { emit, listen } = vi.hoisted(() => ({
  emit: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));

import { requestRecordingShortcutStop } from "./recording-shortcut-stop";

describe("requestRecordingShortcutStop", () => {
  beforeEach(() => {
    emit.mockReset().mockResolvedValue(undefined);
    listen.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes through the pill when its listener acknowledges the request", async () => {
    listen.mockImplementation(async (_event, onAck) => {
      emit.mockImplementation(async (event, payload) => {
        if (event === "clips:tray-stop-request") {
          onAck({ payload: payload.requestId });
        }
      });
      return vi.fn();
    });

    await requestRecordingShortcutStop();

    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "clips:tray-stop-request",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("sends the tray request before slow listener registration and falls back by 250ms", async () => {
    let registerListener!: (unlisten: () => void) => void;
    listen.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          registerListener = resolve;
        }),
    );

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(150);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "clips:tray-stop-request",
      expect.objectContaining({ requestId: expect.any(String) }),
    );

    registerListener(vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(99);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await stopRequest;

    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("stops directly when listener registration never completes", async () => {
    listen.mockImplementation(() => new Promise(() => {}));

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "clips:tray-stop-request",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    await vi.advanceTimersByTimeAsync(249);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await stopRequest;

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenNthCalledWith(2, "clips:recorder-stop");
  });

  it("stops directly when the pill does not acknowledge the request", async () => {
    listen.mockResolvedValue(vi.fn());

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(0);
    expect(emit).toHaveBeenCalledWith("clips:tray-stop-request", {
      requestId: expect.any(String),
    });
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(250);
    await stopRequest;

    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });
});
