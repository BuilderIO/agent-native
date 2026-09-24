import { useCallback } from "react";

import {
  VideoCaptureView,
  type CapturedVideoMedia,
} from "@/components/VideoCaptureView";
import { enqueueCaptureJob } from "@/lib/capture-queue";
import { syncCaptureJob } from "@/lib/clips-api";
import { getClipsSession } from "@/lib/clips-session";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";
import { useMobileNavigation } from "@/lib/navigation";
import { persistCaptureFile } from "@/lib/persist-capture";

export default function VideoCaptureScreen() {
  const navigation = useMobileNavigation();

  const handleCaptured = useCallback(
    async (media: CapturedVideoMedia) => {
      const localUri = await persistCaptureFile(
        media.uri,
        media.mimeType,
        media.captureId,
      );
      const session = await getClipsSession();
      const job = await enqueueCaptureJob({
        id: media.captureId,
        localUri,
        ownerKey: session?.ownerKey,
        kind: "video",
        durationMs: media.durationMs ?? 0,
        mimeType: media.mimeType,
        title: media.title,
      });
      void setMobileCaptureStateBestEffort({
        view: "video",
        phase: "processing",
        captureId: job.id,
      });
      navigation.replace("/");
      void syncCaptureJob(job.id).catch(() => null);
    },
    [navigation],
  );

  return (
    <VideoCaptureView onCancel={navigation.back} onCaptured={handleCaptured} />
  );
}
