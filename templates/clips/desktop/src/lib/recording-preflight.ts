import { invoke } from "@tauri-apps/api/core";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { RewindCaptureSuspensionLease } from "./recorder";
import {
  boundedCleanup,
  guardRecordingStart,
  RecordingStartCancelledError,
  RECORDING_START_TIMEOUT_MS,
} from "./recording-start-guard";

export const RECORDING_PREFLIGHT_TIMEOUT_MS = 15_000;

export class ScreenRecordingPermissionError extends Error {}

export class RecordingStartAttempt {
  readonly controller = new AbortController();
  captureSuspension: RewindCaptureSuspensionLease | null = null;

  get signal() {
    return this.controller.signal;
  }

  cancel() {
    this.controller.abort();
  }

  ensureActive() {
    if (this.signal.aborted) throw new RecordingStartCancelledError();
  }

  async run<T>(
    operation: () => Promise<T>,
    options: {
      timeoutMs?: number | null;
      onLateResolve?: (value: T) => void;
    } = {},
  ): Promise<T> {
    this.ensureActive();
    const value = await guardRecordingStart(operation(), {
      signal: this.signal,
      timeoutMs:
        options.timeoutMs === undefined
          ? RECORDING_PREFLIGHT_TIMEOUT_MS
          : options.timeoutMs,
      onCancel: () => this.cancel(),
      onLateResolve: options.onLateResolve,
    });
    if (this.signal.aborted) {
      options.onLateResolve?.(value);
      this.ensureActive();
    }
    return value;
  }

  async releaseCaptureSuspension() {
    const lease = this.captureSuspension;
    this.captureSuspension = null;
    if (lease) await releaseSuspension(lease);
  }
}

function releaseSuspension(lease: RewindCaptureSuspensionLease) {
  return lease.leaseId
    ? boundedCleanup(
        invoke("rewind_capture_suspension_release", {
          leaseId: lease.leaseId,
        }),
      )
    : Promise.resolve();
}

async function pickDisplay(attempt: RecordingStartAttempt) {
  const unlisteners: UnlistenFn[] = [];
  let resolveSelection!: (id: number | null) => void;
  let rejectSelection!: (error: Error) => void;
  const selection = new Promise<number | null>((resolve, reject) => {
    resolveSelection = resolve;
    rejectSelection = reject;
  });
  void selection.catch(() => {});
  try {
    unlisteners.push(
      await attempt.run(
        () =>
          listen<{ displayId?: number | null }>(
            "clips:monitor-picker-selected",
            ({ payload }) => {
              const id = payload?.displayId;
              resolveSelection(
                typeof id === "number" && Number.isFinite(id) && id > 0
                  ? id
                  : null,
              );
            },
          ),
        { onLateResolve: (unlisten) => unlisten() },
      ),
    );
    unlisteners.push(
      await attempt.run(
        () =>
          listen("clips:monitor-picker-cancelled", () =>
            rejectSelection(new RecordingStartCancelledError()),
          ),
        { onLateResolve: (unlisten) => unlisten() },
      ),
    );
    const shown = await attempt.run(() =>
      invoke<boolean>("show_monitor_picker"),
    );
    if (!shown) return;
    const displayId = await attempt.run(() => selection, { timeoutMs: null });
    await attempt.run(() =>
      invoke("set_recording_display_override", { displayId }),
    );
    await attempt.run(() => invoke("close_monitor_picker"));
  } finally {
    unlisteners.forEach((unlisten) => unlisten());
  }
}

export async function prepareNativeRecordingStart(
  attempt: RecordingStartAttempt,
  options: {
    windowCapture: boolean;
    resumeCapture: boolean;
    microphone: boolean;
  },
) {
  await attempt.run(() => invoke("set_recording_state", { active: true }));
  const granted = await attempt.run(
    () => invoke<boolean>("request_macos_screen_recording_access"),
    { timeoutMs: RECORDING_START_TIMEOUT_MS },
  );
  if (!granted) throw new ScreenRecordingPermissionError();
  if (options.resumeCapture) return;
  if (!options.windowCapture) {
    await pickDisplay(attempt);
    return;
  }
  attempt.captureSuspension = await attempt.run(
    () =>
      invoke<RewindCaptureSuspensionLease>(
        "rewind_capture_suspension_acquire",
        {
          requiresScreen: true,
          requiresMicrophone: options.microphone,
        },
      ),
    {
      onLateResolve: (lease) => {
        void releaseSuspension(lease);
      },
    },
  );
  await attempt.run(() => invoke("park_popover_offscreen"));
  void emit("clips:popover-visible", false).catch(() => {});
  const pickerStartedAt = performance.now();
  console.log("[clips-popover] opening native Window picker");
  const selection = await attempt.run(
    () =>
      invoke<{ windowId: number; width: number; height: number } | null>(
        "show_window_picker",
      ),
    { timeoutMs: null },
  );
  console.log("[clips-popover] native Window picker returned", {
    elapsedMs: Math.round(performance.now() - pickerStartedAt),
    selected: Boolean(selection),
  });
  if (!selection) throw new RecordingStartCancelledError();
}

export async function recoverRecordingStart(
  attempt: RecordingStartAttempt,
  windowCapture: boolean,
) {
  attempt.cancel();
  if (windowCapture) {
    await boundedCleanup(invoke("cancel_native_window_picker"), 8_000);
  }
  await Promise.all([
    attempt.releaseCaptureSuspension(),
    boundedCleanup(invoke("close_monitor_picker")),
    boundedCleanup(invoke("hide_recording_chrome")),
    boundedCleanup(invoke("set_recording_state", { active: false })),
    boundedCleanup(invoke("show_popover")),
  ]);
}
