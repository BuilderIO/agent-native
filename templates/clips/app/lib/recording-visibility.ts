export type RecordingVisibilityAction = "pause" | "resume" | null;

type RecordingVisibilityMode = "screen" | "camera" | "screen+camera";
type RecordingVisibilityRecorderState =
  | "idle"
  | "pickingSources"
  | "countdown"
  | "recording"
  | "paused"
  | "stopping"
  | "compressing"
  | "uploading"
  | "complete"
  | "error";

export interface RecordingVisibilityDecision {
  action: RecordingVisibilityAction;
  autoPaused: boolean;
}

export function isMobileRecorderRuntime(
  navigatorLike: Pick<Navigator, "userAgent"> &
    Partial<Pick<Navigator, "maxTouchPoints" | "platform">> & {
      userAgentData?: { mobile?: boolean };
    },
): boolean {
  return (
    navigatorLike.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod/i.test(navigatorLike.userAgent) ||
    ((navigatorLike.maxTouchPoints ?? 0) > 1 &&
      /Mac/i.test(navigatorLike.platform ?? navigatorLike.userAgent))
  );
}

export function decideRecordingVisibilityAction(input: {
  mode: RecordingVisibilityMode | null;
  mobileRuntime: boolean;
  documentHidden: boolean;
  cameraTrackMuted: boolean;
  recorderState: RecordingVisibilityRecorderState;
  autoPaused: boolean;
}): RecordingVisibilityDecision {
  if (!input.mobileRuntime || input.mode !== "camera") {
    return { action: null, autoPaused: false };
  }

  const captureSuspended = input.documentHidden || input.cameraTrackMuted;
  if (captureSuspended && input.recorderState === "recording") {
    return { action: "pause", autoPaused: true };
  }

  if (
    !captureSuspended &&
    input.autoPaused &&
    input.recorderState === "paused"
  ) {
    return { action: "resume", autoPaused: false };
  }

  if (input.recorderState !== "recording" && input.recorderState !== "paused") {
    return { action: null, autoPaused: false };
  }

  return { action: null, autoPaused: input.autoPaused };
}
