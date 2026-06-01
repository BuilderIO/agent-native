import { retryStaleRemoteCommands } from "./remote-commands-store.js";

const RETRY_INTERVAL_MS = 60_000;

let retryInterval: ReturnType<typeof setInterval> | null = null;
let initialTimer: ReturnType<typeof setTimeout> | null = null;

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
  if (retryInterval) return;

  initialTimer = setTimeout(() => {
    void retryRemoteCommands().catch((err) => {
      console.error("[integrations] Remote command retry job error:", err);
    });
  }, 10_000);
  unrefTimer(initialTimer);

  retryInterval = setInterval(() => {
    void retryRemoteCommands().catch((err) => {
      console.error("[integrations] Remote command retry job error:", err);
    });
  }, RETRY_INTERVAL_MS);
  unrefTimer(retryInterval);
}

export function stopRemoteCommandsRetryJob(): void {
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (retryInterval) {
    clearInterval(retryInterval);
    retryInterval = null;
  }
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  (timer as unknown as { unref?: () => void }).unref?.();
}
