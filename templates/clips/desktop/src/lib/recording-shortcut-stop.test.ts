import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { emit, invoke, listen } = vi.hoisted(() => ({
  emit: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ emit, listen }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

let listenForRecordingShortcutStopAcks: (typeof import("./recording-shortcut-stop"))["listenForRecordingShortcutStopAcks"];
let requestRecordingShortcutStop: (typeof import("./recording-shortcut-stop"))["requestRecordingShortcutStop"];

let unlistenAcks: (() => void) | undefined;

describe("requestRecordingShortcutStop", () => {
  beforeEach(async () => {
    vi.resetModules();
    ({ listenForRecordingShortcutStopAcks, requestRecordingShortcutStop } =
      await import("./recording-shortcut-stop"));
    emit.mockReset().mockResolvedValue(undefined);
    invoke.mockReset().mockResolvedValue(undefined);
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
      reason: "acknowledgement-listener-not-ready",
    });
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
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
    await vi.advanceTimersByTimeAsync(300);
    await stopRequest;

    expect(
      emit.mock.calls.filter(([event]) => event === "clips:tray-stop-request"),
    ).toHaveLength(1);
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("caps direct fallback waits at the absolute stop deadline", async () => {
    emit.mockImplementation((event, payload) => {
      if (event === "clips:tray-stop-request" && payload?.fallback) {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });
    invoke.mockImplementation(() => new Promise(() => {}));

    const stopRequest = requestRecordingShortcutStop();
    await vi.advanceTimersByTimeAsync(69);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await stopRequest;

    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("keeps listener readiness inside the total fallback deadline", async () => {
    let finishRegistration!: (unlisten: () => void) => void;
    listen.mockImplementation(
      async () =>
        new Promise((resolve) => {
          finishRegistration = resolve;
        }),
    );
    const setup = listenForRecordingShortcutStopAcks();
    const stopRequest = requestRecordingShortcutStop();
    emit.mockImplementation((event, payload) => {
      if (event === "clips:tray-stop-request" && payload === undefined) {
        return new Promise(() => {});
      }
      return Promise.resolve(undefined);
    });
    invoke.mockImplementation(() => new Promise(() => {}));

    await vi.advanceTimersByTimeAsync(149);
    finishRegistration(vi.fn());
    unlistenAcks = await setup;
    await vi.advanceTimersByTimeAsync(80);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(50);
    expect(emit).not.toHaveBeenCalledWith("clips:recorder-stop");
    await vi.advanceTimersByTimeAsync(1);
    await stopRequest;

    expect(
      emit.mock.calls.filter(([event]) => event === "clips:tray-stop-request"),
    ).toHaveLength(1);
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("preserves listener registration failures as a distinct direct-stop reason", async () => {
    listen.mockRejectedValue(new Error("listener denied"));
    await expect(listenForRecordingShortcutStopAcks()).rejects.toThrow(
      "listener denied",
    );

    await expect(requestRecordingShortcutStop()).resolves.toEqual({
      type: "direct",
      reason: "acknowledgement-listener-registration-failed",
    });
    expect(emit).toHaveBeenCalledWith("clips:tray-stop-request", {
      fallback: true,
    });
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });

  it("reports an absent acknowledgement listener separately", async () => {
    await expect(requestRecordingShortcutStop()).resolves.toEqual({
      type: "direct",
      reason: "acknowledgement-listener-not-registered",
    });
    expect(emit).toHaveBeenCalledWith("clips:tray-stop-request", {
      fallback: true,
    });
    expect(emit).toHaveBeenLastCalledWith("clips:recorder-stop");
  });
});
