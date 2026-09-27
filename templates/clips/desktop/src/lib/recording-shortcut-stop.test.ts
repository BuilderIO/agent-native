import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { emit, getByLabel, listen } = vi.hoisted(() => ({
  emit: vi.fn(),
  getByLabel: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  WebviewWindow: { getByLabel },
}));

import { requestRecordingShortcutStop } from "./recording-shortcut-stop";

describe("requestRecordingShortcutStop", () => {
  beforeEach(() => {
    emit.mockReset().mockResolvedValue(undefined);
    getByLabel.mockReset();
    listen.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("routes through the pill when its listener acknowledges the request", async () => {
    getByLabel.mockResolvedValue({ label: "toolbar" });
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

  it("stops directly when the toolbar window is unavailable", async () => {
    getByLabel.mockResolvedValue(null);

    await requestRecordingShortcutStop();

    expect(emit).toHaveBeenCalledExactlyOnceWith("clips:recorder-stop");
  });

  it("stops directly when looking up the toolbar window fails", async () => {
    getByLabel.mockRejectedValue(new Error("window lookup failed"));

    await requestRecordingShortcutStop();

    expect(emit).toHaveBeenCalledExactlyOnceWith("clips:recorder-stop");
  });

  it("stops directly when the toolbar window has no mounted listener", async () => {
    getByLabel.mockResolvedValue({ label: "toolbar" });
    listen.mockResolvedValue(vi.fn());

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(500);
    await stopRequest;

    expect(emit).toHaveBeenCalledWith("clips:tray-stop-request", {
      requestId: expect.any(String),
    });
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });
});
