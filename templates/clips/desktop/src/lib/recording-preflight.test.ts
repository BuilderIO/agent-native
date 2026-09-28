import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  prepareNativeRecordingStart,
  recoverRecordingStart,
  RecordingStartAttempt,
  RECORDING_PREFLIGHT_TIMEOUT_MS,
  ScreenRecordingPermissionError,
} from "./recording-preflight";
import {
  RECOVERY_INVOKE_TIMEOUT_MS,
  RECORDING_START_TIMEOUT_MS,
} from "./recording-start-guard";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
  emit: vi.fn(async () => {}),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const options = { windowCapture: true, resumeCapture: false, microphone: true };
const lease = { leaseId: "test-suspension", suspendedRewind: true };
const handlers = new Map<string, (event: { payload: unknown }) => void>();
let unlisten: ReturnType<typeof vi.fn>;

function defaultReply(command: string): Promise<unknown> {
  if (
    command === "request_macos_screen_recording_access" ||
    command === "show_monitor_picker"
  )
    return Promise.resolve(true);
  if (command === "rewind_capture_suspension_acquire")
    return Promise.resolve(lease);
  if (command === "show_window_picker")
    return Promise.resolve({ windowId: 42, width: 1280, height: 720 });
  return Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  handlers.clear();
  unlisten = vi.fn();
  vi.mocked(invoke).mockImplementation(defaultReply as typeof invoke);
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    handlers.set(name, handler as (event: { payload: unknown }) => void);
    return unlisten;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("native recording preflight", () => {
  it("does not release Screen Memory or restore chrome until the native picker dismisses", async () => {
    const dismissal = deferred<void>();
    vi.mocked(invoke).mockImplementation(
      (command) =>
        (command === "cancel_native_window_picker"
          ? dismissal.promise
          : defaultReply(command)) as ReturnType<typeof invoke>,
    );
    const attempt = new RecordingStartAttempt();
    attempt.captureSuspension = lease;
    const recovery = recoverRecordingStart(attempt, true);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(invoke).mock.calls).toEqual([
      ["cancel_native_window_picker"],
    ]);
    expect(attempt.captureSuspension).toBe(lease);
    dismissal.resolve();
    await recovery;
    expect(invoke).toHaveBeenCalledWith("rewind_capture_suspension_release", {
      leaseId: lease.leaseId,
    });
    expect(invoke).toHaveBeenCalledWith("show_popover");
    expect(attempt.captureSuspension).toBeNull();
  });

  it("prepares a selected window and retains its lease for the recorder", async () => {
    const attempt = new RecordingStartAttempt();
    await prepareNativeRecordingStart(attempt, options);
    expect(attempt.captureSuspension).toBe(lease);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "set_recording_state",
      "request_macos_screen_recording_access",
      "rewind_capture_suspension_acquire",
      "park_popover_offscreen",
      "show_window_picker",
    ]);
    expect(invoke).not.toHaveBeenCalledWith("show_toolbar");
  });

  it.each([
    "set_recording_state",
    "request_macos_screen_recording_access",
    "rewind_capture_suspension_acquire",
    "park_popover_offscreen",
    "show_window_picker",
  ])(
    "cancels during %s without advancing when it later returns",
    async (stalledCommand) => {
      const pending = deferred<unknown>();
      vi.mocked(invoke).mockImplementation(
        (command) =>
          (command === stalledCommand
            ? pending.promise
            : defaultReply(command)) as ReturnType<typeof invoke>,
      );
      const attempt = new RecordingStartAttempt();
      const result = prepareNativeRecordingStart(attempt, options);
      const rejection = expect(result).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(invoke).toHaveBeenCalledWith(
        stalledCommand,
        ...(stalledCommand === "set_recording_state"
          ? [{ active: true }]
          : stalledCommand === "rewind_capture_suspension_acquire"
            ? [{ requiresScreen: true, requiresMicrophone: true }]
            : []),
      );
      attempt.cancel();
      await rejection;
      const commandsBeforeLateReply = vi.mocked(invoke).mock.calls.length;
      pending.resolve(await defaultReply(stalledCommand));
      await vi.advanceTimersByTimeAsync(0);
      const lateCommands = vi
        .mocked(invoke)
        .mock.calls.slice(commandsBeforeLateReply);
      expect(lateCommands).toEqual(
        stalledCommand === "rewind_capture_suspension_acquire"
          ? [["rewind_capture_suspension_release", { leaseId: lease.leaseId }]]
          : [],
      );
    },
  );

  it.each([
    ["set_recording_state", RECORDING_PREFLIGHT_TIMEOUT_MS],
    ["request_macos_screen_recording_access", RECORDING_START_TIMEOUT_MS],
    ["rewind_capture_suspension_acquire", RECORDING_PREFLIGHT_TIMEOUT_MS],
    ["park_popover_offscreen", RECORDING_PREFLIGHT_TIMEOUT_MS],
  ])("bounds the machine operation %s", async (stalledCommand, timeoutMs) => {
    vi.mocked(invoke).mockImplementation(
      (command) =>
        (command === stalledCommand
          ? new Promise(() => {})
          : defaultReply(command)) as ReturnType<typeof invoke>,
    );
    const attempt = new RecordingStartAttempt();
    const rejection = expect(
      prepareNativeRecordingStart(attempt, options),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(Number(timeoutMs));
    await rejection;
    expect(attempt.signal.aborted).toBe(true);
    expect(invoke).not.toHaveBeenCalledWith("show_window_picker");
  });

  it("lets the user select a window after several minutes", async () => {
    const picker = deferred<unknown>();
    vi.mocked(invoke).mockImplementation(
      (command) =>
        (command === "show_window_picker"
          ? picker.promise
          : defaultReply(command)) as ReturnType<typeof invoke>,
    );
    const attempt = new RecordingStartAttempt();
    const result = prepareNativeRecordingStart(attempt, options);
    const settled = vi.fn();
    void result.then(settled);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(settled).not.toHaveBeenCalled();
    expect(attempt.signal.aborted).toBe(false);
    picker.resolve({ windowId: 42, width: 1280, height: 720 });
    await result;
  });

  it("treats picker dismissal as cancellation and recovers through the native cancel command", async () => {
    vi.mocked(invoke).mockImplementation(
      (command) =>
        (command === "show_window_picker"
          ? Promise.resolve(null)
          : defaultReply(command)) as ReturnType<typeof invoke>,
    );
    const attempt = new RecordingStartAttempt();
    await expect(
      prepareNativeRecordingStart(attempt, options),
    ).rejects.toMatchObject({ name: "AbortError" });
    await recoverRecordingStart(attempt, true);
    expect(invoke).toHaveBeenCalledWith("cancel_native_window_picker");
    expect(invoke).toHaveBeenCalledWith("set_recording_state", {
      active: false,
    });
    expect(invoke).toHaveBeenCalledWith("show_popover");
    expect(invoke).toHaveBeenCalledWith("rewind_capture_suspension_release", {
      leaseId: lease.leaseId,
    });
    expect(attempt.captureSuspension).toBeNull();
  });

  it("does not open a picker when permission is denied", async () => {
    vi.mocked(invoke).mockResolvedValue(false);
    await expect(
      prepareNativeRecordingStart(new RecordingStartAttempt(), options),
    ).rejects.toBeInstanceOf(ScreenRecordingPermissionError);
    expect(invoke).not.toHaveBeenCalledWith("show_window_picker");
  });

  it("does not reprompt for a picker or acquire a preflight lease on restart", async () => {
    await prepareNativeRecordingStart(new RecordingStartAttempt(), {
      ...options,
      resumeCapture: true,
    });
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual([
      "set_recording_state",
      "request_macos_screen_recording_access",
    ]);
  });

  it("keeps display selection user-controlled and persists only an active selection", async () => {
    const attempt = new RecordingStartAttempt();
    const result = prepareNativeRecordingStart(attempt, {
      ...options,
      windowCapture: false,
    });
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(attempt.signal.aborted).toBe(false);
    handlers.get("clips:monitor-picker-selected")?.({
      payload: { displayId: 7 },
    });
    await result;
    expect(invoke).toHaveBeenCalledWith("set_recording_display_override", {
      displayId: 7,
    });
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("ignores a late display selection after cancellation", async () => {
    const attempt = new RecordingStartAttempt();
    const result = prepareNativeRecordingStart(attempt, {
      ...options,
      windowCapture: false,
    });
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(0);
    attempt.cancel();
    await rejection;
    handlers.get("clips:monitor-picker-selected")?.({
      payload: { displayId: 7 },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(invoke).not.toHaveBeenCalledWith("set_recording_display_override", {
      displayId: 7,
    });
    expect(unlisten).toHaveBeenCalledTimes(2);
  });

  it("bounds recovery and lets a retry own its lease while releasing a late old lease", async () => {
    const acquisition = deferred<unknown>();
    vi.mocked(invoke).mockImplementation(
      (command) =>
        (command === "rewind_capture_suspension_acquire"
          ? acquisition.promise
          : defaultReply(command)) as ReturnType<typeof invoke>,
    );
    const oldAttempt = new RecordingStartAttempt();
    const rejection = expect(
      prepareNativeRecordingStart(oldAttempt, options),
    ).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    oldAttempt.cancel();
    await rejection;
    vi.mocked(invoke).mockImplementation(() => new Promise(() => {}));
    const recovery = recoverRecordingStart(oldAttempt, true);
    await vi.advanceTimersByTimeAsync(RECOVERY_INVOKE_TIMEOUT_MS + 8_000);
    await recovery;
    vi.mocked(invoke).mockImplementation(defaultReply as typeof invoke);
    const retry = new RecordingStartAttempt();
    await prepareNativeRecordingStart(retry, options);
    const beforeLateReply = vi.mocked(invoke).mock.calls.length;
    acquisition.resolve({ leaseId: "old-lease", suspendedRewind: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.mocked(invoke).mock.calls.slice(beforeLateReply)).toEqual([
      ["rewind_capture_suspension_release", { leaseId: "old-lease" }],
    ]);
    expect(retry.captureSuspension).toBe(lease);
    expect(retry.signal.aborted).toBe(false);
  });
});
