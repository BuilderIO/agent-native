export const CANCEL_STOP_TIMEOUT_MS = 5_000;

export type RecorderStopOutcome = "stopped" | "already-inactive" | "timed-out";

export async function stopRecorderWithin(
  recorder: Pick<MediaRecorder, "state" | "stop">,
  stopped: Promise<unknown>,
  timeoutMs: number,
): Promise<RecorderStopOutcome> {
  if (recorder.state === "inactive") return "already-inactive";
  recorder.stop();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timed-out">((resolve) => {
    timer = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  const settled = stopped.then(
    () => "stopped" as const,
    () => "stopped" as const,
  );
  try {
    return await Promise.race([settled, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
