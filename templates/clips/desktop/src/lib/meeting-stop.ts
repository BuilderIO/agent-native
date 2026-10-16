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

const STOP_CONFIRMATION_RETRY_DELAYS_MS = [150, 450] as const;
const TERMINAL_MEETING_STOP_ERROR_CODES = new Set(["meeting_not_found"]);

export function isTerminalMeetingStopError(
  error: unknown,
): error is ClipsActionError {
  return (
    error instanceof ClipsActionError &&
    error.status === 404 &&
    Boolean(error.code && TERMINAL_MEETING_STOP_ERROR_CODES.has(error.code))
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
    await flushTranscript();
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
      await flushTranscript();
      return { status: "confirmed" };
    }

    const retryDelayMs = STOP_CONFIRMATION_RETRY_DELAYS_MS[attempt];
    if (retryDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  if (terminalStopError !== undefined) {
    await waitForHistory();
    await flushTranscript();
    return { status: "terminal", error: terminalStopError };
  }

  const error = new Error(
    "The server did not confirm that the meeting recording stopped.",
  );
  if (lastError !== undefined) Object.assign(error, { cause: lastError });
  throw error;
}
