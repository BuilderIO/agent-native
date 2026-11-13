import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import {
  fetchServerUploadStatus,
  isProcessingStuck,
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
  updateRecordingBackupMeta,
  verifyServerCopy,
  type RecordingBackupMeta,
} from "@/lib/recording-backup";

const RECOVERY_TOAST_ID = "clips-local-recording-recovery";
let recoveryToastRevision = 0;
let recoveryToastId: string | undefined;
let recoveryToastSequence = 0;
let recoveryScanSequence = 0;
let lastAppliedRecoveryScan = 0;
const snoozingRecordings = new Set<string>();
const cleaningRecordings = new Set<string>();
let cleanupRevision = 0;

function nextRecoveryToastId(): string {
  if (recoveryToastId) toast.dismiss(recoveryToastId);
  recoveryToastId = `${RECOVERY_TOAST_ID}-${++recoveryToastSequence}`;
  return recoveryToastId;
}

function clearRecoveryToast(id: string): void {
  if (recoveryToastId !== id) return;
  recoveryToastId = undefined;
  recoveryToastRevision += 1;
}

/** Rechecks while a copy's server row is still processing; the last repeats. */
const PROCESSING_RECHECK_MS = [15_000, 30_000, 60_000, 120_000, 300_000];

/** "Remind me tomorrow" hides a copy's prompt this long; the copy stays. */
const REMIND_LATER_MS = 24 * 60 * 60_000;

export interface LocalRecordingScan {
  /** Copies to offer: unfinished, ownerless, or kept after an upload. */
  pending: RecordingBackupMeta[];
  /**
   * Copies to look at again soon: their server row is still processing, or
   * it is proven but another tab held the copy when this scan tried to
   * delete it.
   */
  waitingOnServer: number;
}

/**
 * Delete a copy the server has proven it holds in full. The copy's Web Lock
 * is taken first, so a copy another tab is still using is never deleted, and
 * without Web Locks nothing is deleted at all.
 */
async function deleteConfirmedCopy(
  meta: RecordingBackupMeta,
): Promise<"deleted" | "busy" | "unavailable"> {
  if (cleaningRecordings.has(meta.recordingId)) return "busy";
  cleaningRecordings.add(meta.recordingId);
  cleanupRevision += 1;
  try {
    const claim = await claimRecordingBackupLock(meta.recordingId);
    if (claim.status !== "held") return claim.status;
    try {
      // coercion-ok: copies from before stale tracking have no superseded rows.
      await trashStaleServerRecordings(meta.staleServerRecordingIds ?? []);
      await deleteRecordingBackup(meta.recordingId);
      return "deleted";
    } finally {
      claim.release();
    }
  } finally {
    cleaningRecordings.delete(meta.recordingId);
    cleanupRevision += 1;
  }
}

/**
 * The local copies that still need the user. A copy the server proves it
 * holds in full (exact bytes, matching duration) is deleted here, including
 * one kept after an earlier unproven upload; one it is still processing is
 * counted so the caller rechecks, until it has processed too long and is
 * offered. A "ready" status with no proof, or a copy that was cut short, is
 * offered rather than deleted. An ownerless copy whose server row this account
 * can read is stamped; any other ownerless copy comes back unstamped for an
 * explicit claim. A copy whose check fails is still offered: a failure never
 * hides a recording. A copy the user snoozed is left out until its time.
 */
export async function findLocalRecordingsToFinish(
  ownerEmail: string,
  nowMs = Date.now(),
  signal?: AbortSignal,
): Promise<LocalRecordingScan> {
  const cleanupAtStart = new Set(cleaningRecordings);
  const cleanupRevisionAtStart = cleanupRevision;
  const [metas, liveIds] = await Promise.all([
    listRecordingBackupMetas(),
    // coercion-ok: null is "liveness unknown"; without locks nothing is uploaded or deleted unclaimed.
    liveRecordingBackupIds().catch(() => null),
  ]);
  const pending: RecordingBackupMeta[] = [];
  // A scan can observe another scan's temporary cleanup lock as a live copy.
  let waitingOnServer = selectRecoverableRecordingBackups(metas, {
    liveIds: null,
    ownerEmail,
  }).filter(
    (meta) =>
      liveIds?.has(meta.recordingId) &&
      (cleanupAtStart.has(meta.recordingId) ||
        cleaningRecordings.has(meta.recordingId) ||
        cleanupRevisionAtStart !== cleanupRevision),
  ).length;
  for (const meta of selectRecoverableRecordingBackups(metas, {
    liveIds,
    ownerEmail,
  })) {
    try {
      signal?.throwIfAborted();
      const serverId =
        meta.serverRecordingId ?? (meta.localOnly ? null : meta.recordingId);
      if (!serverId) {
        pending.push(meta);
        continue;
      }
      // coercion-ok: null is "server unreachable" (unlike { found: false }); the copy is still offered.
      const server = await fetchServerUploadStatus(serverId, signal).catch(
        (error: unknown) => {
          if (signal?.aborted) throw error;
          return null;
        },
      );
      if (server?.found && server.status === "processing") {
        if (isProcessingStuck(meta, nowMs)) pending.push(meta);
        else waitingOnServer += 1;
        continue;
      }
      if (server?.found && server.status === "ready") {
        const whole =
          !!meta.completedAt &&
          !meta.incomplete &&
          meta.keptAfterUpload !== "partial";
        const proof = verifyServerCopy(server, {
          bytes: meta.bytes,
          durationMs: meta.durationMs,
        });
        if (whole && proof === "verified") {
          // A copy that could not be deleted is never hidden: it stays
          // offered, and one another tab held is checked again soon.
          const deleted = await deleteConfirmedCopy(meta);
          if (deleted !== "deleted") pending.push(meta);
          if (deleted === "busy") waitingOnServer += 1;
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
      if (signal?.aborted) throw err;
      console.warn(
        `[clips] checking local recording ${meta.recordingId} failed:`,
        err,
      );
      pending.push(meta);
    }
  }
  return {
    pending: pending.filter(
      (meta) => !(Date.parse(meta.remindAfter ?? "") > nowMs),
    ),
    waitingOnServer,
  };
}

/** Stop prompting about a copy until tomorrow; the copy itself is kept. */
export async function remindLaterAboutLocalRecording(
  recordingId: string,
  nowMs = Date.now(),
): Promise<void> {
  await updateRecordingBackupMeta(recordingId, {
    remindAfter: new Date(nowMs + REMIND_LATER_MS).toISOString(),
  });
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
    onResult: (
      scan: LocalRecordingScan,
      scanSequence: number,
      toastRevision: number,
    ) => void;
    onError: (
      error: unknown,
      retry: () => void,
      scanSequence: number,
      toastRevision: number,
    ) => void;
  },
  delaysMs: readonly number[] = PROCESSING_RECHECK_MS,
): () => void {
  let stopped = false;
  const controller = new AbortController();
  let attempt = 0;
  let latestScan = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const scan = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const scanSequence = ++recoveryScanSequence;
    latestScan = scanSequence;
    const toastRevision = recoveryToastRevision;
    const run = async () => {
      if (stopped) return;
      let result: LocalRecordingScan;
      try {
        result = await findLocalRecordingsToFinish(
          ownerEmail,
          Date.now(),
          controller.signal,
        );
      } catch (error) {
        if (!stopped && latestScan === scanSequence)
          handlers.onError(error, scan, scanSequence, toastRevision);
        return;
      }
      if (stopped || latestScan !== scanSequence) return;
      handlers.onResult(result, scanSequence, toastRevision);
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (result.waitingOnServer > 0) {
        const delay = delaysMs[Math.min(attempt, delaysMs.length - 1)];
        attempt += 1;
        timer = setTimeout(scan, delay);
      } else {
        attempt = 0;
      }
    };
    void run().catch((error: unknown) => {
      console.error("[clips] local recording recovery handler failed:", error);
    });
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
    controller.abort();
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
type RecoveryOffer = {
  meta: Pick<
    RecordingBackupMeta,
    "recordingId" | "ownerEmail" | "keptAfterUpload" | "state"
  >;
  t: ReturnType<typeof useT>;
  navigate: (path: string) => unknown;
  onFinish?: (recordingId: string) => void;
};

export function offerLocalRecording(options: RecoveryOffer): void {
  recoveryToastRevision += 1;
  showLocalRecording(options);
}

function showLocalRecording(options: RecoveryOffer): void {
  const { meta, t, navigate, onFinish } = options;
  const unclaimed = !meta.ownerEmail;
  // Uploaded and kept, or still processing on the server.
  const kept = !!meta.keptAfterUpload || meta.state === "uploaded";
  const toastId = nextRecoveryToastId();
  toast.warning(
    unclaimed
      ? t("recordRoute.unclaimedRecording")
      : kept
        ? t("recordRoute.keptCopyWaiting")
        : t("recordRoute.unfinishedRecording"),
    {
      id: toastId,
      duration: Infinity,
      closeButton: true,
      onDismiss: () => clearRecoveryToast(toastId),
      cancel: {
        label: t("recordRoute.remindTomorrow"),
        onClick: () => {
          clearRecoveryToast(toastId);
          snoozingRecordings.add(meta.recordingId);
          void remindLaterAboutLocalRecording(meta.recordingId)
            .catch((err: unknown) => {
              console.warn("[clips] could not snooze the reminder:", err);
            })
            .finally(() => {
              snoozingRecordings.delete(meta.recordingId);
              recoveryToastRevision += 1;
            });
        },
      },
      action: {
        label:
          unclaimed || kept
            ? t("recordRoute.reviewRecording")
            : t("recordRoute.finishUpload"),
        onClick: () => {
          clearRecoveryToast(toastId);
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
      onResult: ({ pending }, scanSequence, toastRevision) => {
        if (
          scanSequence < lastAppliedRecoveryScan ||
          toastRevision !== recoveryToastRevision
        )
          return;
        lastAppliedRecoveryScan = scanSequence;
        const newest = pending.find(
          (meta) => !snoozingRecordings.has(meta.recordingId),
        );
        if (!newest) {
          if (recoveryToastId) {
            const id = recoveryToastId;
            recoveryToastId = undefined;
            toast.dismiss(id);
          }
          return;
        }
        // One prompt for the newest; finishing it rescans on the next load.
        showLocalRecording({
          meta: newest,
          t,
          navigate,
          onFinish: onFinishRef.current
            ? (recordingId) => onFinishRef.current?.(recordingId)
            : undefined,
        });
      },
      onError: (error, retry, scanSequence, toastRevision) => {
        if (
          scanSequence < lastAppliedRecoveryScan ||
          toastRevision !== recoveryToastRevision
        )
          return;
        lastAppliedRecoveryScan = scanSequence;
        console.warn("[clips] local recording recovery scan failed:", error);
        const toastId = nextRecoveryToastId();
        toast.error(t("recordRoute.savedRecordingsUnreadable"), {
          id: toastId,
          duration: Infinity,
          closeButton: true,
          onDismiss: () => clearRecoveryToast(toastId),
          action: { label: t("recordRoute.tryAgain"), onClick: retry },
        });
      },
    });
  }, [enabled, navigate, ownerEmail, t]);
}
