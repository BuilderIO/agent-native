import { runSessionReplayRetentionSweep } from "../lib/session-replay";

let running = false;

/**
 * Run one session replay retention sweep. Exported for deployment-specific
 * scheduled functions that should not rely on a long-lived Node process.
 */
export async function runSessionReplayRetentionOnce(): Promise<{
  finalized: number;
  expired: number;
  chunks: number;
  blobDeleteFailures: number;
}> {
  if (running) {
    return {
      finalized: 0,
      expired: 0,
      chunks: 0,
      blobDeleteFailures: 0,
    };
  }
  running = true;
  try {
    return await runSessionReplayRetentionSweep();
  } finally {
    running = false;
  }
}
