import {
  CaptureTeardownUnconfirmedError,
  type CaptureStartGate,
} from "@shared/capture-host-runner";

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Agent capture start was cancelled.", "AbortError");
}

export function abortable<T>(
  operation: Promise<T>,
  signal: AbortSignal,
  onLateValue?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortReason(signal));
    };
    operation.then(
      (value) => {
        if (settled) {
          onLateValue?.(value);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function skippableDelay(
  delayMs: number,
  signal: AbortSignal,
): { done: Promise<void>; skip: () => void } {
  let skip: () => void = () => undefined;
  const done = new Promise<void>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(finish, Math.max(0, delayMs));
    skip = finish;
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return { done, skip };
}

export interface AgentTakeSteps<Ready> {
  arm(
    signal: AbortSignal,
  ): Promise<{ recordingId: string; startDelayMs: number }>;
  countdown(delayMs: number, signal: AbortSignal): Promise<void>;
  begin(signal: AbortSignal): Promise<void>;
  waitForReady(signal: AbortSignal): Promise<Ready>;
  tearDown(): Promise<void>;
}

export async function startGatedAgentTake<Ready>(
  steps: AgentTakeSteps<Ready>,
  signal: AbortSignal,
  gate: CaptureStartGate,
): Promise<{ recordingId: string; ready: Ready }> {
  try {
    signal.throwIfAborted();
    const armed = await steps.arm(signal);
    signal.throwIfAborted();
    await steps.countdown(armed.startDelayMs, signal);
    signal.throwIfAborted();
    await gate.confirmBegin();
    signal.throwIfAborted();
    await steps.begin(signal);
    const ready = await steps.waitForReady(signal);
    signal.throwIfAborted();
    return { recordingId: armed.recordingId, ready };
  } catch (cause) {
    await steps.tearDown();
    throw cause;
  }
}

export interface AgentTakeCancellation {
  ok: boolean;
  error?: string | null;
  clipRemoved: boolean;
  clipError?: string | null;
}

export async function discardAgentTake(
  cancel: () => Promise<AgentTakeCancellation>,
): Promise<void> {
  const cancelled = await cancel();
  if (!cancelled.ok) {
    throw new CaptureTeardownUnconfirmedError(
      `Recorder teardown is unconfirmed: ${cancelled.error || "the recorder did not confirm it stopped."}`,
    );
  }
  if (!cancelled.clipRemoved) {
    throw new Error(
      `The discarded take stopped, but its Clip could not be removed: ${cancelled.clipError || "unknown error"}`,
    );
  }
}
