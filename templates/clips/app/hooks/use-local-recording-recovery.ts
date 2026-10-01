import { useSession } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { useEffect } from "react";
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
let scannedThisPageLoad = false;

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

/** Once per page load, offer to finish any recording left in this browser. */
export function useLocalRecordingRecovery(enabled = true) {
  const t = useT();
  const navigate = useNavigate();
  const { session } = useSession();
  const ownerEmail = session?.email ?? null;

  useEffect(() => {
    if (!enabled || !ownerEmail || scannedThisPageLoad) return;
    if (!recordingBackupAvailable()) return;
    scannedThisPageLoad = true;
    void findLocalRecordingsToFinish(ownerEmail)
      .then((pending) => {
        const newest = pending[0];
        if (!newest) return;
        // One prompt for the newest; finishing it rescans on the next load.
        toast.warning(t("recordRoute.unfinishedRecording"), {
          id: RECOVERY_TOAST_ID,
          duration: Infinity,
          closeButton: true,
          action: {
            label: t("recordRoute.finishUpload"),
            onClick: () => {
              void navigate(
                `/record?localRecording=${encodeURIComponent(newest.recordingId)}`,
              );
            },
          },
        });
      })
      .catch((err) => {
        scannedThisPageLoad = false;
        console.warn("[clips] local recording recovery scan failed:", err);
      });
  }, [enabled, navigate, ownerEmail, t]);
}
