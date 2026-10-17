import { ClipsActionError } from "./clips-action";

interface StopMeetingBeforeTranscriptFlushOptions {
  stopRecording: () => Promise<void>;
  isStopped: () => Promise<boolean>;
  waitForHistory: () => Promise<void>;
  flushTranscript: () => Promise<void>;
  terminalStopError?: ClipsActionError;
  onTerminalStopError?: (error: ClipsActionError) => void;
}

export type StopMeetingBeforeTranscriptFlushResult =
  | { status: "confirmed" }
  | { status: "terminal"; error: ClipsActionError };

export type MeetingStopCompletion =
  | { completed: true }
  | { completed: false; holdQuit: boolean; error: ClipsActionError };

export function resolveMeetingStopCompletion(
  result: MeetingStopCompletion,
): "completed" | "hold-quit" {
  if (result.completed) return "completed";
  if (result.holdQuit) return "hold-quit";
  throw result.error;
}

const STOP_CONFIRMATION_RETRY_DELAYS_MS = [150, 450] as const;
const TERMINAL_MEETING_STOP_ERROR_CODES = new Set(["meeting_not_found"]);
const TERMINAL_TRANSCRIPT_SAVE_ERRORS = new Set([
  "404:recording_not_found",
  "403:forbidden",
]);

export function isTerminalMeetingStopError(
  error: unknown,
): error is ClipsActionError {
  return (
    error instanceof ClipsActionError &&
    error.status === 404 &&
    Boolean(error.code && TERMINAL_MEETING_STOP_ERROR_CODES.has(error.code))
  );
}

export function isTerminalTranscriptSaveError(
  error: unknown,
): error is ClipsActionError {
  return (
    error instanceof ClipsActionError &&
    Boolean(
      error.code &&
      TERMINAL_TRANSCRIPT_SAVE_ERRORS.has(`${error.status}:${error.code}`),
    )
  );
}

export function isTerminalTranscriptSaveResult(
  result: StopMeetingBeforeTranscriptFlushResult,
): boolean {
  return (
    result.status === "terminal" && isTerminalTranscriptSaveError(result.error)
  );
}

export function shouldHoldQuitForTranscriptRecovery(
  quitTeardownPending: boolean,
  result: StopMeetingBeforeTranscriptFlushResult,
): boolean {
  return quitTeardownPending && isTerminalTranscriptSaveResult(result);
}

export function canDiscardTerminalTranscriptForReplacement(params: {
  quitting: boolean;
  activeMeetingId: string | null;
  failedMeetingId: string;
  terminalTranscriptFailure: boolean;
  stopPending: boolean;
  queuedMeetingId: string | null;
  requestedMeetingId: string;
}): boolean {
  return (
    !params.quitting &&
    params.activeMeetingId === params.failedMeetingId &&
    params.terminalTranscriptFailure &&
    params.stopPending &&
    params.queuedMeetingId === params.requestedMeetingId
  );
}

export async function stopMeetingBeforeTranscriptFlush({
  stopRecording,
  isStopped,
  waitForHistory,
  flushTranscript,
  terminalStopError: previousTerminalStopError,
  onTerminalStopError,
}: StopMeetingBeforeTranscriptFlushOptions): Promise<StopMeetingBeforeTranscriptFlushResult> {
  if (isTerminalMeetingStopError(previousTerminalStopError)) {
    await waitForHistory();
    try {
      await flushTranscript();
    } catch (error) {
      if (isTerminalTranscriptSaveError(error)) {
        return { status: "terminal", error };
      }
      throw error;
    }
    return { status: "terminal", error: previousTerminalStopError };
  }

  let lastError: unknown;
  let terminalStopError: ClipsActionError | undefined;
  for (
    let attempt = 0;
    attempt <= STOP_CONFIRMATION_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      await stopRecording();
    } catch (error) {
      lastError = error;
      if (isTerminalMeetingStopError(error)) {
        terminalStopError = error;
        onTerminalStopError?.(error);
        break;
      }
    }

    let confirmed = false;
    try {
      confirmed = await isStopped();
    } catch (error) {
      lastError = error;
    }
    if (confirmed) {
      await waitForHistory();
      try {
        await flushTranscript();
      } catch (error) {
        if (isTerminalTranscriptSaveError(error)) {
          return { status: "terminal", error };
        }
        throw error;
      }
      return { status: "confirmed" };
    }

    const retryDelayMs = STOP_CONFIRMATION_RETRY_DELAYS_MS[attempt];
    if (retryDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (terminalStopError !== undefined) {
    await waitForHistory();
    try {
      await flushTranscript();
    } catch (error) {
      if (isTerminalTranscriptSaveError(error)) {
        return { status: "terminal", error };
      }
      throw error;
    }
    return { status: "terminal", error: terminalStopError };
  }

  const error = new Error(
    "The server did not confirm that the meeting recording stopped.",
  );
  if (lastError !== undefined) Object.assign(error, { cause: lastError });
  throw error;
}
