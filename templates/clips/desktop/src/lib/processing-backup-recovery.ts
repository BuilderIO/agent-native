import {
  verifyFinalizeReceipt,
  type LocalRecordingProof,
} from "./upload-verification";

/**
 * Wait for a processing upload to finish, then clean up its local backup.
 * With `local`, a ready row is proof only when it reports the same source
 * bytes and a matching duration; anything less keeps the backup and passes
 * the reason to `onUnresolved`.
 */
export async function reconcileProcessingBackup(args: {
  waitForReady: () => Promise<{
    status?: string;
    sourceSizeBytes?: number;
    durationMs?: number;
  } | null>;
  local?: () => Promise<LocalRecordingProof | null>;
  onReady: () => Promise<unknown>;
  onUnresolved: (reason?: string) => Promise<unknown>;
  onPollError?: (error: unknown) => void;
}): Promise<"ready" | "unresolved"> {
  let reason: string | undefined;
  try {
    const recovered = await args.waitForReady();
    if (recovered?.status === "ready") {
      const local = args.local ? await args.local() : null;
      reason = local ? unprovenReason(recovered, local) : undefined;
      if (!reason) {
        await args.onReady();
        return "ready";
      }
    }
  } catch (error) {
    args.onPollError?.(error);
  }

  await args.onUnresolved(reason);
  return "unresolved";
}

function unprovenReason(
  ready: { sourceSizeBytes?: number; durationMs?: number },
  local: LocalRecordingProof,
): string | undefined {
  try {
    verifyFinalizeReceipt(
      { ok: true, finalized: true, status: "ready", ...ready },
      local,
    );
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
