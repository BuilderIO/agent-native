export type BackgroundJobStop = () => void | Promise<void>;

/** How long shutdown waits for jobs to stop before it carries on without them. */
const STOP_TIMEOUT_MS = 5_000;

const stoppers = new Set<BackgroundJobStop>();

export function registerBackgroundJobStop(stop: BackgroundJobStop): void {
  stoppers.add(stop);
}

export async function stopBackgroundJobs(
  timeoutMs = STOP_TIMEOUT_MS,
): Promise<void> {
  const toStop = [...stoppers];
  stoppers.clear();
  const pending = new Set(toStop);
  const stopped = Promise.all(
    toStop.map(async (stop) => {
      try {
        await stop();
      } catch (error) {
        console.error("[agent-native] background job stop failed:", error);
      } finally {
        pending.delete(stop);
      }
    }),
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
    timer.unref?.();
  });
  await Promise.race([stopped, timedOut]);
  clearTimeout(timer);
  if (pending.size > 0) {
    const names = [...pending].map((stop) => stop.name || "anonymous");
    console.warn(
      `[agent-native] background jobs still stopping after ${timeoutMs}ms; shutting down without them: ${names.join(", ")}`,
    );
  }
}
