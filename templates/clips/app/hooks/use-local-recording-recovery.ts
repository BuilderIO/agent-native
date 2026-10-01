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
  deleteRecordingBackup,
  listRecordingBackupMetas,
  liveRecordingBackupIds,
  recordingBackupAvailable,
  selectRecoverableRecordingBackups,
  type RecordingBackupMeta,
} from "@/lib/recording-backup";

const RECOVERY_TOAST_ID = "clips-local-recording-recovery";

/**
 * The local copies that still need an upload. Copies the server already has
 * as `ready` are deleted here; ones it is still processing wait for a later
 * scan; a copy whose server row this account cannot see was never offered
 * to this account and is left alone.
 */
export async function findLocalRecordingsToFinish(
  ownerEmail: string,
): Promise<RecordingBackupMeta[]> {
  const [metas, liveIds] = await Promise.all([
    listRecordingBackupMetas(),
    liveRecordingBackupIds().catch(() => null),
  ]);
  const pending: RecordingBackupMeta[] = [];
  for (const meta of selectRecoverableRecordingBackups(metas, {
    liveIds,
    ownerEmail,
  })) {
    const serverId =
      meta.serverRecordingId ?? (meta.localOnly ? null : meta.recordingId);
    if (serverId) {
      const server = await fetchServerUploadStatus(serverId).catch(() => null);
      if (server?.found && server.status === "ready") {
        await trashStaleServerRecordings(meta.staleServerRecordingIds ?? []);
        await deleteRecordingBackup(meta.recordingId);
        continue;
      }
      if (server?.found && server.status === "processing") continue;
      if (server && !server.found && !meta.ownerEmail) continue;
    }
    pending.push(meta);
  }
  return pending;
}

/**
 * When the app shell or an idle recorder mounts, offer to finish any
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
    let cancelled = false;
    void findLocalRecordingsToFinish(ownerEmail)
      .then((pending) => {
        const newest = pending[0];
        if (cancelled || !newest) return;
        // One prompt for the newest; finishing it rescans on the next load.
        toast.warning(t("recordRoute.unfinishedRecording"), {
          id: RECOVERY_TOAST_ID,
          duration: Infinity,
          closeButton: true,
          action: {
            label: t("recordRoute.finishUpload"),
            onClick: () => {
              if (onFinishRef.current) {
                onFinishRef.current(newest.recordingId);
                return;
              }
              void navigate(
                `/record?localRecording=${encodeURIComponent(newest.recordingId)}`,
              );
            },
          },
        });
      })
      .catch((err) => {
        console.warn("[clips] local recording recovery scan failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, navigate, ownerEmail, t]);
}
