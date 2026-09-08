import type { ScreenMemoryConfig, ScreenMemoryStatus } from "../shared/config";

export type RewindPresentationKind =
  | "off"
  | "paused"
  | "recording"
  | "excluded"
  | "idle"
  | "error"
  | "unavailable";

export interface RewindStatusPresentation {
  kind: RewindPresentationKind;
  title: string;
  detail: string;
  isLive: boolean;
  hasError: boolean;
}

export function getRewindStatusPresentation({
  status,
  config,
  clipRecordingActive = false,
}: {
  status: ScreenMemoryStatus | null;
  config: ScreenMemoryConfig;
  clipRecordingActive?: boolean;
}): RewindStatusPresentation {
  const runtimeConfig = status?.config ?? config;

  if (!runtimeConfig.enabled || status?.state === "disabled") {
    return {
      kind: "off",
      title: "Rewind is off",
      detail: "Private memory for moments you may need later.",
      isLive: false,
      hasError: false,
    };
  }

  if (runtimeConfig.paused || status?.state === "paused") {
    return {
      kind: "paused",
      title: "Rewind is paused",
      detail: "Existing local memory is still available.",
      isLive: false,
      hasError: false,
    };
  }

  if (status?.exclusionActive) {
    return {
      kind: "excluded",
      title: "Rewind is protecting a private moment",
      detail:
        status.coverage || "An excluded app is in front, so capture is paused.",
      isLive: false,
      hasError: false,
    };
  }

  if (status?.available === false) {
    return {
      kind: "unavailable",
      title: "Rewind is unavailable",
      detail: "Capture isn't available on this device.",
      isLive: false,
      hasError: false,
    };
  }

  if (status?.state === "recording") {
    return {
      kind: "recording",
      title: "Rewind is remembering",
      detail:
        status.lastError ||
        status.coverage ||
        "New moments are being saved to this device.",
      isLive: true,
      hasError: Boolean(status.lastError),
    };
  }

  if (status?.lastError) {
    return {
      kind: "error",
      title: "Rewind needs attention",
      detail: status.lastError,
      isLive: false,
      hasError: true,
    };
  }

  return {
    kind: "idle",
    title: "Rewind is on but not capturing",
    detail: clipRecordingActive
      ? "Rewind will resume when this Clip ends."
      : "Nothing new is being saved right now.",
    isLive: false,
    hasError: false,
  };
}
