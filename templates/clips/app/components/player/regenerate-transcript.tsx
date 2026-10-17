import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface RegenerateTranscriptRequest {
  recordingId: string;
  replaceImportId: string | null;
}

/**
 * A regenerate discards an imported file's transcript, so it asks first. The
 * request names the transcript the user saw, so it never replaces an import
 * that lands after the page loaded.
 */
export function useRegenerateTranscript(
  importId: string | null | undefined,
  request: (args: RegenerateTranscriptRequest) => void,
) {
  const t = useT();
  const [confirming, setConfirming] = useState<{
    recordingId: string;
    importId: string;
  } | null>(null);

  const regenerate = (recordingId: string) => {
    if (importId) {
      setConfirming({ recordingId, importId });
      return;
    }
    request({ recordingId, replaceImportId: null });
  };

  const dialog = (
    <AlertDialog
      open={confirming !== null}
      onOpenChange={(open) => {
        if (!open) setConfirming(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t("transcriptImport.regenerateOverImportTitle")}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t("transcriptImport.regenerateOverImportDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (!confirming) return;
              request({
                recordingId: confirming.recordingId,
                replaceImportId: confirming.importId,
              });
            }}
          >
            {t("transcriptPanel.regenerate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { regenerate, dialog };
}
