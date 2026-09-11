import {
  startIntervalJob,
  type IntervalJobHandle,
} from "../server/interval-job.js";
import { retryStaleRemoteCommands } from "./remote-commands-store.js";

const RETRY_INTERVAL_MS = 60_000;

let job: IntervalJobHandle | null = null;
let startupTimer: ReturnType<typeof setTimeout> | null = null;

export async function retryRemoteCommands(): Promise<{
  retried: number;
  failed: number;
}> {
  try {
    return await retryStaleRemoteCommands();
  } catch {
    if (process.env.DEBUG) {
      console.log(
        "[integrations] remote command retry job: tables not ready, skipping",
      );
    }
    return { retried: 0, failed: 0 };
  }
}

export function startRemoteCommandsRetryJob(): void {
  if (job || startupTimer) return;

  startupTimer = setTimeout(() => {
    startupTimer = null;
    job = startIntervalJob(
      async () => {
        await retryRemoteCommands();
      },
      {
        intervalMs: RETRY_INTERVAL_MS,
        onError: (err) => {
          console.error("[integrations] Remote command retry job error:", err);
        },
      },
    );
  }, 10_000);
  startupTimer.unref?.();
}

export function stopRemoteCommandsRetryJob(): void {
  if (startupTimer) {
    clearTimeout(startupTimer);
    startupTimer = null;
  }
  job?.stop();
  job = null;
}
