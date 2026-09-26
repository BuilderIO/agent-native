
export type PillDoneStage = "finishing" | "uploading" | "uploaded" | "failed";

export type NativeUploadFinished = {
  recordingId?: string;
  ok?: boolean;
  viewUrl?: string;
  error?: string | null;
  localFilePath?: string | null;
};

export type PillCompletion = {
  stage: "uploaded" | "failed";
  savedLocally: boolean;
  viewUrl: string | null;
};

export function isCompletionForSession(
  sessionRecordingId: string | null | undefined,
  payload: { recordingId?: string },
): boolean {
  if (!sessionRecordingId || !payload.recordingId) return true;
  return payload.recordingId === sessionRecordingId;
}

export function resolveCompletion(
  sessionRecordingId: string | null | undefined,
  payload: NativeUploadFinished,
): PillCompletion | null {
  if (!isCompletionForSession(sessionRecordingId, payload)) {
    return null;
  }
  return {
    stage: payload.ok ? "uploaded" : "failed",
    savedLocally: Boolean(payload.localFilePath),
    viewUrl: payload.viewUrl ?? null,
  };
}

export type PillCardTone = "pending" | "ok" | "warn";

export type PillCardState = {
  title: string;
  detail: string;
  tone: PillCardTone;
};

export function completionCardState(
  stage: PillDoneStage,
  session: { hasLink: boolean; savedLocally: boolean },
): PillCardState {
  switch (stage) {
    case "uploaded":
      return {
        title: "Recording saved",
        detail: session.hasLink ? "" : "saved on this device",
        tone: "ok",
      };
    case "failed":
      return {
        title: "Upload paused",
        detail: session.savedLocally ? "saved on this device" : "",
        tone: "warn",
      };
    case "uploading":
      return { title: "Uploading", detail: "", tone: "pending" };
    case "finishing":
      return { title: "Finishing up", detail: "", tone: "pending" };
  }
}
