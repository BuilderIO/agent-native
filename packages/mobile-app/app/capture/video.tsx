import { useRouter } from "expo-router";
import { useCallback } from "react";

import {
  VideoCaptureView,
  type CapturedVideoMedia,
} from "@/components/VideoCaptureView";
import { enqueueCaptureJob } from "@/lib/capture-queue";
import { syncCaptureJob } from "@/lib/clips-api";
import { getClipsSession } from "@/lib/clips-session";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";
import { persistCaptureFile } from "@/lib/persist-capture";

export default function VideoCaptureScreen() {
  const router = useRouter();

  const handleCaptured = useCallback(
    async (media: CapturedVideoMedia) => {
      const localUri = await persistCaptureFile(media.uri, media.mimeType);
      const session = await getClipsSession();
      const job = await enqueueCaptureJob({
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
      router.replace("/" as never);
      void syncCaptureJob(job.id).catch(() => null);
    },
    [router],
  );

  return (
    <VideoCaptureView
      onCancel={() => router.back()}
      onCaptured={handleCaptured}
    />
  );
}
