import {
  NativeCompositionClockError,
  withNativeCompositionFrame,
  type NativeCompositionFrame,
  type NativeCompositionFrameOptions,
} from "./native-composition-clock";

export interface NativeCompositionSessionHooks<Snapshot, Rendered, Consumed> {
  suspend(): Snapshot;
  restore(snapshot: Snapshot): void;
  hold(error: unknown): void;
  invalidateSources(): void;
  render(timeSeconds: number, signal: AbortSignal): Promise<Rendered>;
  consume(rendered: Rendered, frame: NativeCompositionFrame): Promise<Consumed>;
}

export async function runNativeCompositionSession<Snapshot, Rendered, Consumed>(
  options: NativeCompositionFrameOptions,
  hooks: NativeCompositionSessionHooks<Snapshot, Rendered, Consumed>,
): Promise<{
  frameIndex: number;
  fps: number;
  startTimeSeconds: number;
  timeSeconds: number;
  value: Consumed;
}> {
  const snapshot = hooks.suspend();
  let failed = false;
  let failure: unknown;
  try {
    return await withNativeCompositionFrame(
      {
        ...options,
        onSourceClockChange: () => {
          options.onSourceClockChange?.();
          hooks.invalidateSources();
        },
      },
      async (frame) => {
        if (frame.signal.aborted) throw frame.signal.reason;
        const result = await hooks.render(frame.timeSeconds, frame.signal);
        if (frame.signal.aborted) throw frame.signal.reason;
        const consumed = await hooks.consume(result, frame);
        if (frame.signal.aborted) throw frame.signal.reason;
        return consumed;
      },
    );
  } catch (error) {
    failed = true;
    failure = error;
    throw error;
  } finally {
    try {
      if (
        failed &&
        failure instanceof NativeCompositionClockError &&
        ["composition-render-unsettled", "composition-restore-failed"].includes(
          failure.code,
        )
      )
        hooks.hold(failure);
      else hooks.restore(snapshot);
    } catch (restoreError) {
      let holdFailed = false;
      let holdError: unknown;
      try {
        hooks.hold(restoreError);
      } catch (error) {
        holdFailed = true;
        holdError = error;
      }
      throw new NativeCompositionClockError(
        "composition-restore-failed",
        "The native runtime clock could not be restored.",
        [
          ...(failed ? [failure] : []),
          restoreError,
          ...(holdFailed ? [holdError] : []),
        ],
      );
    }
  }
}
