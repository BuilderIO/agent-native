import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { emit, listen } = vi.hoisted(() => ({
  emit: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));

import {
  listenForRecordingShortcutStopAcks,
  requestRecordingShortcutStop,
} from "./recording-shortcut-stop";

let unlistenAcks: (() => void) | undefined;

describe("requestRecordingShortcutStop", () => {
  beforeEach(() => {
    emit.mockReset().mockResolvedValue(undefined);
    listen.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    unlistenAcks?.();
    unlistenAcks = undefined;
    vi.useRealTimers();
  });

  it("routes through the pill when its listener acknowledges the request", async () => {
    let acknowledge!: (event: { payload: string }) => void;
    listen.mockImplementation(async (_event, onAck) => {
      acknowledge = onAck;
      return vi.fn();
    });
    unlistenAcks = await listenForRecordingShortcutStopAcks();
    emit.mockImplementation(async (event, payload) => {
      if (event === "clips:tray-stop-request") {
        acknowledge({ payload: payload.requestId });
      }
    });

    await expect(requestRecordingShortcutStop()).resolves.toEqual({
      type: "pill",
    });

    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "clips:tray-stop-request",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("waits for an ack listener that is still registering", async () => {
    let acknowledge!: (event: { payload: string }) => void;
    let finishRegistration!: (unlisten: () => void) => void;
    listen.mockImplementation(
      async (_event, onAck) =>
        new Promise((resolve) => {
          acknowledge = onAck;
          finishRegistration = resolve;
        }),
    );
    const setup = listenForRecordingShortcutStopAcks();
    const stopRequest = requestRecordingShortcutStop();
    emit.mockImplementation(async (event, payload) => {
      if (event === "clips:tray-stop-request") {
        acknowledge({ payload: payload.requestId });
      }
    });

    await vi.advanceTimersByTimeAsync(100);
    finishRegistration(vi.fn());
    unlistenAcks = await setup;

    await expect(stopRequest).resolves.toEqual({ type: "pill" });
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      "clips:tray-stop-request",
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("stops directly if ack listener setup does not finish promptly", async () => {
    listen.mockImplementation(() => new Promise<() => void>(() => {}));
    void listenForRecordingShortcutStopAcks();

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(149);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await expect(stopRequest).resolves.toEqual({
      type: "direct",
      reason: "pill-did-not-acknowledge",
    });
    expect(emit).toHaveBeenCalledExactlyOnceWith("clips:recorder-stop");
  });

  it("stops directly when the pill does not acknowledge the request", async () => {
    listen.mockResolvedValue(vi.fn());
    unlistenAcks = await listenForRecordingShortcutStopAcks();

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
