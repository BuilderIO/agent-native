import { useRouter } from "expo-router";
import { useCallback } from "react";
import { SafeAreaView } from "react-native-safe-area-context";

import AudioCaptureView, {
  type CapturedAudioMedia,
} from "@/components/AudioCaptureView";
import { enqueueCaptureJob } from "@/lib/capture-queue";
import { syncCaptureJob } from "@/lib/clips-api";
import { getClipsSession } from "@/lib/clips-session";
import { setMobileCaptureStateBestEffort } from "@/lib/mobile-state-api";
import { persistCaptureFile } from "@/lib/persist-capture";

export default function MeetingCaptureScreen() {
  const router = useRouter();

  const handleCaptured = useCallback(
    async (media: CapturedAudioMedia) => {
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
        kind: "meeting",
        durationMs: media.durationMs,
        mimeType: media.mimeType,
        title: media.title,
        capturedAt: media.startedAt,
      });
      void setMobileCaptureStateBestEffort({
        view: "meeting",
        phase: "processing",
        captureId: job.id,
      });
      router.replace("/" as never);
      void syncCaptureJob(job.id).catch(() => null);
    },
    [router],
  );

  return (
    <SafeAreaView edges={["top", "bottom"]} style={{ flex: 1 }}>
      <AudioCaptureView
        kind="meeting"
        onCancel={() => router.back()}
        onCaptured={handleCaptured}
      />
    </SafeAreaView>
  );
}
