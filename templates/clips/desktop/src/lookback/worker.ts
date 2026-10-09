import type { createPrivateAgentRewindRecording } from "../lib/recorder";
import type {
  RecordingContextItem,
  RecordingContextUpdate,
} from "./context-api";

type UploadMode = Awaited<
  ReturnType<typeof createPrivateAgentRewindRecording>
>["uploadMode"];

export interface LookbackOrigin {
  includeMicrophone: boolean;
  includeSystemAudio: boolean;
}

// The caller wires these to the same calls processRewindExtension makes:
// createPrivateAgentRewindRecording and the rewind_agent_handoff_upload command.
export interface LookbackWorkerDeps {
  // Null when this device did not capture the recording, so its footage is not here.
  originFor(recordingId: string): LookbackOrigin | null;
  update(input: RecordingContextUpdate): Promise<unknown>;
  createRecording(input: {
    hasAudio: boolean;
    startedAt: string;
  }): Promise<{ id: string; uploadMode: UploadMode }>;
  uploadWindow(input: {
    requestId: string;
    startedAt: string;
    endedAt: string;
    recordingId: string;
    uploadMode: UploadMode;
    includeMic: boolean;
    includeSystemAudio: boolean;
  }): Promise<{
    durationMs: number;
    width?: number | null;
    height?: number | null;
  }>;
  trashRecording(id: string): Promise<unknown>;
}

export type LookbackWorkerOutcome = "skipped" | "ready" | "failed";

const FALLBACK_ERROR = "Earlier screen time couldn't be saved.";

export async function processRecordingContextItem(
  item: RecordingContextItem,
  deps: LookbackWorkerDeps,
): Promise<LookbackWorkerOutcome> {
  const origin = deps.originFor(item.recordingId);
  // Footage only leaves the device that captured it. Another device's item
  // stays pending for that device's worker.
  if (!origin) return "skipped";

  await deps.update({ id: item.id, status: "processing" });

  let mediaRecordingId: string | null = null;
  try {
    const recording = await deps.createRecording({
      hasAudio: origin.includeMicrophone || origin.includeSystemAudio,
      startedAt: item.startedAt,
    });
    mediaRecordingId = recording.id;
    const upload = await deps.uploadWindow({
      requestId: `handoff-lookback-${item.id}`,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      recordingId: recording.id,
      uploadMode: recording.uploadMode,
      includeMic: origin.includeMicrophone,
      includeSystemAudio: origin.includeSystemAudio,
    });
    await deps.update({
      id: item.id,
      status: "ready",
      mediaRecordingId: recording.id,
      durationMs: Math.round(upload.durationMs),
      ...(upload.width && upload.width > 0 ? { width: upload.width } : {}),
      ...(upload.height && upload.height > 0 ? { height: upload.height } : {}),
    });
  } catch (error) {
    const message =
      error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
    if (mediaRecordingId) {
      await deps.trashRecording(mediaRecordingId).catch((cleanupError) => {
        console.warn(
          "[lookback] trashing the unused window recording failed:",
          cleanupError,
        );
      });
    }
    await deps.update({ id: item.id, status: "failed", error: message });
    return "failed";
  }

  // A re-export replaces the footage, so the previous private recording is
  // no longer linked from the item and can be removed.
  if (item.mediaRecordingId && item.mediaRecordingId !== mediaRecordingId) {
    await deps.trashRecording(item.mediaRecordingId).catch((cleanupError) => {
      console.warn(
        "[lookback] trashing the replaced window recording failed:",
        cleanupError,
      );
    });
  }
  return "ready";
}
