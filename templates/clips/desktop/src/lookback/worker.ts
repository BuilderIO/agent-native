import { ClipsActionError } from "../lib/clips-action";
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
  // Null means the server reports the item absent, removed, or its Clip gone. A failed read must throw.
  currentItem(
    recordingId: string,
    itemId: string,
  ): Promise<RecordingContextItem | null>;
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

  // The footage recording exists before the claim so the claim can name it.
  // The server keeps that id as the reservation and rejects a ready write for
  // any other recording, which binds the result to this claim.
  let recording: { id: string; uploadMode: UploadMode };
  try {
    recording = await deps.createRecording({
      hasAudio: origin.includeMicrophone || origin.includeSystemAudio,
      startedAt: item.startedAt,
    });
  } catch (error) {
    // failed is reachable only from processing, so claim first, without footage.
    try {
      await deps.update({ id: item.id, status: "processing" });
    } catch (claimError) {
      if (isConflict(claimError)) {
        console.warn(
          "[lookback] another claim owns the item; creating its footage failed with:",
          error,
        );
        return "skipped";
      }
      console.error(
        "[lookback] claiming the item to record its failure failed:",
        claimError,
      );
      return "failed";
    }
    await markFailed(item, error, deps);
    return "failed";
  }

  try {
    await deps.update({
      id: item.id,
      status: "processing",
      mediaRecordingId: recording.id,
    });
  } catch (error) {
    if (isConflict(error)) {
      // Another claim or a trim owns the item. Our footage was never linked.
      await trashUnusedRecording(recording.id, deps);
      return "skipped";
    }
    // The claim may have landed before its response was lost.
    return failAfterClaim(item, recording.id, error, deps);
  }

  let upload: Awaited<ReturnType<LookbackWorkerDeps["uploadWindow"]>>;
  try {
    upload = await deps.uploadWindow({
      requestId: `handoff-lookback-${item.id}`,
      startedAt: item.startedAt,
      endedAt: item.endedAt,
      recordingId: recording.id,
      uploadMode: recording.uploadMode,
      includeMic: origin.includeMicrophone,
      includeSystemAudio: origin.includeSystemAudio,
    });
  } catch (error) {
    return failAfterClaim(item, recording.id, error, deps);
  }

  try {
    await deps.update({
      id: item.id,
      status: "ready",
      mediaRecordingId: recording.id,
      durationMs: Math.round(upload.durationMs),
      ...(upload.width && upload.width > 0 ? { width: upload.width } : {}),
      ...(upload.height && upload.height > 0 ? { height: upload.height } : {}),
    });
  } catch (error) {
    // The server rejected this write, so its footage is unlinked. The item now
    // belongs to a newer reservation or a moved state, so nothing is marked failed.
    if (isConflict(error)) {
      await trashUnusedRecording(recording.id, deps);
      return "skipped";
    }
    return failAfterClaim(item, recording.id, error, deps);
  }

  await trashReplacedFootage(item, recording.id, deps);
  return "ready";
}

// Runs when a step after the claim fails. The failed step may have committed on
// the server before its response was lost, so the item's current state decides
// what happens to the footage. Footage the item links is never trashed.
async function failAfterClaim(
  item: RecordingContextItem,
  recordingId: string,
  error: unknown,
  deps: LookbackWorkerDeps,
): Promise<LookbackWorkerOutcome> {
  let current: RecordingContextItem | null;
  try {
    current = await deps.currentItem(item.recordingId, item.id);
  } catch (readError) {
    // The state is unknown, so the footage may be linked. Keep it and write
    // nothing. A processing item whose claim goes stale is picked up again.
    console.error(
      "[lookback] reading the item after a failed export failed; keeping its footage:",
      error,
      readError,
    );
    return "failed";
  }

  // The item is gone, so no item links this footage and nothing is left to
  // mark failed. Nothing later will clean it up, so it is trashed here.
  if (current === null) {
    console.warn(
      "[lookback] the item is gone after a failed export; trashing its footage:",
      error,
    );
    await trashUnusedRecording(recordingId, deps);
    return "skipped";
  }

  if (current.mediaRecordingId === recordingId) {
    console.warn(
      "[lookback] the export committed before its error; keeping its footage:",
      error,
    );
    if (current.status !== "ready") return "skipped";
    await trashReplacedFootage(item, recordingId, deps);
    return "ready";
  }

  await trashUnusedRecording(recordingId, deps);
  if (
    current.status === "processing" &&
    current.pendingMediaRecordingId === recordingId
  ) {
    await markFailed(item, error, deps);
  }
  return "failed";
}

// Writes the failure only while the item is still processing. A 409 means the
// item moved past this claim, so there is nothing left for this export to record.
async function markFailed(
  item: RecordingContextItem,
  error: unknown,
  deps: LookbackWorkerDeps,
): Promise<void> {
  const message =
    error instanceof Error && error.message ? error.message : FALLBACK_ERROR;
  try {
    await deps.update({ id: item.id, status: "failed", error: message });
  } catch (writeError) {
    if (isConflict(writeError)) return;
    console.error(
      "[lookback] recording the export failure failed:",
      writeError,
    );
  }
}

// A re-export replaces the footage, so the previous private recording is no
// longer linked from the item and can be removed.
async function trashReplacedFootage(
  item: RecordingContextItem,
  recordingId: string,
  deps: LookbackWorkerDeps,
): Promise<void> {
  if (!item.mediaRecordingId || item.mediaRecordingId === recordingId) return;
  await deps.trashRecording(item.mediaRecordingId).catch((cleanupError) => {
    console.warn(
      "[lookback] trashing the replaced window recording failed:",
      cleanupError,
    );
  });
}

async function trashUnusedRecording(
  id: string,
  deps: LookbackWorkerDeps,
): Promise<void> {
  await deps.trashRecording(id).catch((cleanupError) => {
    console.warn(
      "[lookback] trashing the unused window recording failed:",
      cleanupError,
    );
  });
}

function isConflict(error: unknown): boolean {
  return error instanceof ClipsActionError && error.status === 409;
}
