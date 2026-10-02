import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  fetchServerUploadStatus,
  trashStaleServerRecordings,
} from "@/lib/local-recording-upload";
import {
  claimRecordingBackupLock,
  claimRecordingBackupOwner,
  deleteRecordingBackup,
  listRecordingBackupMetas,
  liveRecordingBackupIds,
  recordingBackupAvailable,
  selectRecoverableRecordingBackups,
  verifyServerCopy,
  type RecordingBackupMeta,
} from "@/lib/recording-backup";

const RECOVERY_TOAST_ID = "clips-local-recording-recovery";

/** Rechecks while a copy's server row is still processing; the last repeats. */
const PROCESSING_RECHECK_MS = [15_000, 30_000, 60_000, 120_000, 300_000];

export interface LocalRecordingScan {
  /** Copies to offer: unfinished, ownerless, or kept after an upload. */
  pending: RecordingBackupMeta[];
  /** Copies whose server row is still processing; rescan to settle them. */
  waitingOnServer: number;
}

/**
 * Delete a copy the server has proven it holds in full. The copy's Web Lock
 * is taken first, so a copy another tab is still using is never deleted, and
 * without Web Locks nothing is deleted at all.
 */
async function deleteConfirmedCopy(
  meta: RecordingBackupMeta,
): Promise<boolean> {
  const claim = await claimRecordingBackupLock(meta.recordingId);
  if (claim.status !== "held") return false;
  try {
    // coercion-ok: copies from before stale tracking have no superseded rows.
    await trashStaleServerRecordings(meta.staleServerRecordingIds ?? []);
    await deleteRecordingBackup(meta.recordingId);
    return true;
  } finally {
    claim.release();
  }
}

/**
 * The local copies that still need the user. A copy the server proves it
 * holds in full (exact bytes, matching duration) is deleted here; one it is
 * still processing is counted so the caller rechecks. A "ready" status with
 * no proof, or a copy that was cut short, is offered rather than deleted. An
 * ownerless copy whose server row this account can read is stamped; any
 * other ownerless copy comes back unstamped for an explicit claim. A copy
 * whose check fails is still offered: a failure never hides a recording.
 */
export async function findLocalRecordingsToFinish(
  ownerEmail: string,
): Promise<LocalRecordingScan> {
  const [metas, liveIds] = await Promise.all([
    listRecordingBackupMetas(),
    // coercion-ok: null is "liveness unknown"; without locks nothing is uploaded or deleted unclaimed.
    liveRecordingBackupIds().catch(() => null),
  ]);
  const pending: RecordingBackupMeta[] = [];
  let waitingOnServer = 0;
  for (const meta of selectRecoverableRecordingBackups(metas, {
    liveIds,
    ownerEmail,
  })) {
    try {
      const serverId =
        meta.serverRecordingId ?? (meta.localOnly ? null : meta.recordingId);
      if (!serverId) {
        pending.push(meta);
        continue;
      }
      // coercion-ok: null is "server unreachable" (unlike { found: false }); the copy is still offered.
      const server = await fetchServerUploadStatus(serverId).catch(() => null);
      if (server?.found && server.status === "processing") {
        waitingOnServer += 1;
        continue;
      }
      if (server?.found && server.status === "ready") {
        const whole =
          !!meta.completedAt && !meta.incomplete && !meta.keptAfterUpload;
        const proof = verifyServerCopy(server, {
          bytes: meta.bytes,
          durationMs: meta.durationMs,
        });
        if (whole && proof === "verified") {
          // Not deleted when another tab holds it; the next scan retries.
          await deleteConfirmedCopy(meta);
          continue;
        }
        pending.push(meta);
        continue;
      }
      if (server?.found && !meta.ownerEmail) {
        // The status route is owner-scoped, so reading the row proves the
        // copy was recorded under this account.
        pending.push(
          await claimRecordingBackupOwner(meta.recordingId, ownerEmail),
        );
        continue;
      }
      pending.push(meta);
    } catch (err) {
      console.warn(
        `[clips] checking local recording ${meta.recordingId} failed:`,
        err,
      );
      pending.push(meta);
    }
  }
  return { pending, waitingOnServer };
}

/**
 * Scan now, again with backoff while any copy's server row is processing,
 * and again whenever the page becomes visible. `onError` receives a scan
 * that could not read the local copies at all, which is never "nothing to
 * recover".
 */
export function watchLocalRecordings(
  ownerEmail: string,
  handlers: {
    onResult: (scan: LocalRecordingScan) => void;
    onError: (error: unknown, retry: () => void) => void;
  },
  delaysMs: readonly number[] = PROCESSING_RECHECK_MS,
): () => void {
  let stopped = false;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scan = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    void findLocalRecordingsToFinish(ownerEmail).then(
      (result) => {
        if (stopped) return;
        handlers.onResult(result);
        if (result.waitingOnServer > 0) {
          const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)];
          attempt += 1;
          timer = setTimeout(scan, delay);
        } else {
          attempt = 0;
        }
      },
      (error: unknown) => {
        if (!stopped) handlers.onError(error, scan);
      },
    );
  };
  const onVisible = () => {
    if (
      typeof document !== "undefined" &&
      document.visibilityState === "visible"
    ) {
      attempt = 0;
      scan();
    }
  };
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
  scan();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", onVisible);
    }
  };
}

/**
 * Offer one local copy for upload. The action re-checks the copy's Web Lock
 * when clicked, because the prompt can stay open while another tab takes the
 * copy. An ownerless copy always opens the recorder's explicit claim step.
 */
export function offerLocalRecording(options: {
  meta: Pick<
    RecordingBackupMeta,
    "recordingId" | "ownerEmail" | "keptAfterUpload"
  >;
  t: ReturnType<typeof useT>;
  navigate: (path: string) => unknown;
  onFinish?: (recordingId: string) => void;
}): void {
  const { meta, t, navigate, onFinish } = options;
  const unclaimed = !meta.ownerEmail;
  const kept = !!meta.keptAfterUpload;
  toast.warning(
    unclaimed
      ? t("recordRoute.unclaimedRecording")
      : kept
        ? t("recordRoute.keptCopyWaiting")
        : t("recordRoute.unfinishedRecording"),
    {
      id: RECOVERY_TOAST_ID,
      duration: Infinity,
      closeButton: true,
      action: {
        label:
          unclaimed || kept
            ? t("recordRoute.reviewRecording")
            : t("recordRoute.finishUpload"),
        onClick: () => {
          void (async () => {
            // coercion-ok: null is "liveness unknown"; the recorder claims the lock before it acts.
            const live = await liveRecordingBackupIds().catch(() => null);
            if (live?.has(meta.recordingId)) {
              toast.info(t("recordRoute.localRecordingOpenElsewhere"));
              return;
            }
            if (onFinish && !unclaimed) {
              onFinish(meta.recordingId);
              return;
            }
            void navigate(
              `/record?localRecording=${encodeURIComponent(meta.recordingId)}`,
            );
          })();
        },
      },
    },
  );
}

/**
 * While the app shell or an idle recorder is mounted, offer to finish any
 * recording left in this browser. The toast id keeps it to one prompt.
 */
export function useLocalRecordingRecovery(
  enabled = true,
  /** Finish in place; the recorder uses this so no route load is needed. */
  onFinish?: (recordingId: string) => void,
) {
  const t = useT();
  const navigate = useNavigate();
  const { session } = useSession();
  const ownerEmail = session?.email ?? null;
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    if (!enabled || !ownerEmail || !recordingBackupAvailable()) return;
    return watchLocalRecordings(ownerEmail, {
      onResult: ({ pending }) => {
        const newest = pending[0];
        if (!newest) return;
        // One prompt for the newest; finishing it rescans on the next load.
        offerLocalRecording({
          meta: newest,
          t,
          navigate,
          onFinish: onFinishRef.current
            ? (recordingId) => onFinishRef.current?.(recordingId)
            : undefined,
        });
      },
      onError: (error, retry) => {
        console.warn("[clips] local recording recovery scan failed:", error);
        toast.error(t("recordRoute.savedRecordingsUnreadable"), {
          id: RECOVERY_TOAST_ID,
          duration: Infinity,
          closeButton: true,
          action: { label: t("recordRoute.tryAgain"), onClick: retry },
        });
      },
    });
  }, [enabled, navigate, ownerEmail, t]);
}
