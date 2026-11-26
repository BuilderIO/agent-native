export type CaptureQuality = "normal" | "motion";

export const SCREEN_CAPTURE_FRAME_RATE = 24;
export const MOTION_CAPTURE_FRAME_RATE = 60;
export const MOTION_STREAM_FRAME_RATE = 75;
export const SCREEN_CAPTURE_MAX_WIDTH = 1920;
export const SCREEN_CAPTURE_MAX_HEIGHT = 1080;

export type ScreenCaptureSurface = "browser" | "window" | "monitor";

export type ScreenCaptureVideoConstraints = MediaTrackConstraints & {
  displaySurface: ScreenCaptureSurface;
};

export interface CaptureFrameRateInfo {
  captureMode: CaptureQuality;
  requestedFrameRate: number;
  trackReportedFrameRate: number | null;
  observedFrameRate: number | null;
}

export type CaptureStartClockSource =
  | "media-recorder-start-event"
  | "native-recorder-start"
  | "recorder-start-call";

export interface RecordingCaptureMetadata extends CaptureFrameRateInfo {
  width: number | null;
  height: number | null;
  startedAtMs: number | null;
  startUncertaintyMs: number | null;
  startClockSource: CaptureStartClockSource | null;
}

export function isMotionCaptureMetadataJson(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  try {
    const parsed: unknown = JSON.parse(value);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      "captureMode" in parsed &&
      parsed.captureMode === "motion"
    );
  } catch {
    // coercion-ok: unparseable capture metadata names no capture mode, so it cannot mark a take as Motion.
    return false;
  }
}

export function captureMetadataJsonToStore(
  requested: { captureMode?: string | null } | null | undefined,
  storedJson: string | null | undefined,
): string | undefined {
  if (!requested) return undefined;
  if (
    requested.captureMode !== "motion" &&
    isMotionCaptureMetadataJson(storedJson)
  ) {
    return undefined;
  }
  return JSON.stringify(requested);
}

export function captureFrameRate(
  captureMode: CaptureQuality = "normal",
): number {
  return captureMode === "motion"
    ? MOTION_CAPTURE_FRAME_RATE
    : SCREEN_CAPTURE_FRAME_RATE;
}

export function trackReportedCaptureFrameRate(
  source: MediaStream | MediaStreamTrack | null | undefined,
): number | null {
  const track = !source
    ? undefined
    : "getVideoTracks" in source
      ? source.getVideoTracks()[0]
      : source;
  const value = track?.getSettings().frameRate;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(value, MOTION_CAPTURE_FRAME_RATE)
    : null;
}

export function screenCaptureVideoConstraints(
  displaySurface: ScreenCaptureSurface,
  captureMode: CaptureQuality = "normal",
): ScreenCaptureVideoConstraints {
  const frameRate =
    captureMode === "motion"
      ? MOTION_STREAM_FRAME_RATE
      : captureFrameRate(captureMode);
  return {
    frameRate: {
      ideal: frameRate,
      max: frameRate,
    },
    width: {
      ideal: SCREEN_CAPTURE_MAX_WIDTH,
      max: SCREEN_CAPTURE_MAX_WIDTH,
    },
    height: {
      ideal: SCREEN_CAPTURE_MAX_HEIGHT,
      max: SCREEN_CAPTURE_MAX_HEIGHT,
    },
    displaySurface,
  };
}

export type ScreenCaptureDisplayOptions = {
  video: ScreenCaptureVideoConstraints;
  audio: boolean;
  selfBrowserSurface: "include" | "exclude";
  surfaceSwitching: "include" | "exclude";
  systemAudio: "include" | "exclude";
};

export function screenCaptureDisplayOptions(
  displaySurface: ScreenCaptureSurface,
  wantsMic: boolean,
  nativeResolution?: { width: number; height: number },
  captureMode: CaptureQuality = "normal",
): ScreenCaptureDisplayOptions {
  const video = screenCaptureVideoConstraints(displaySurface, captureMode);
  if (displaySurface === "monitor" && nativeResolution) {
    video.width = {
      ideal: nativeResolution.width,
      max: nativeResolution.width,
    };
    video.height = {
      ideal: nativeResolution.height,
      max: nativeResolution.height,
    };
  }
  return {
    video,
    audio: wantsMic,
    selfBrowserSurface: displaySurface === "browser" ? "include" : "exclude",
    surfaceSwitching: "include",
    systemAudio: wantsMic ? "include" : "exclude",
  };
}
