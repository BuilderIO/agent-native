import type { CaptureQuality } from "../../../shared/recording-capture";
import type { CaptureMode, CaptureSource } from "./recorder";

export type AgentCaptureRefusalCode =
  | "window_capture_unsupported"
  | "region_capture_unsupported"
  | "camera_only_unsupported"
  | "native_capture_unavailable";

export class AgentCaptureRefusal extends Error {
  constructor(
    readonly code: AgentCaptureRefusalCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentCaptureRefusal";
  }
}

export function agentCaptureSourceRefusal({
  source,
  mode,
  nativeFullscreenAvailable,
}: {
  source: CaptureSource;
  mode: CaptureMode;
  nativeFullscreenAvailable: boolean;
}): AgentCaptureRefusal | null {
  if (mode === "camera") {
    return new AgentCaptureRefusal(
      "camera_only_unsupported",
      "Agent capture records a screen. Choose a screen mode and Full screen, then arm agent capture again.",
    );
  }
  if (source === "window") {
    return new AgentCaptureRefusal(
      "window_capture_unsupported",
      "Agent capture records the full screen only, not a single window. Choose Full screen, then arm agent capture again.",
    );
  }
  if (source === "region") {
    return new AgentCaptureRefusal(
      "region_capture_unsupported",
      "Agent capture records the full screen only, not a region. Choose Full screen, then arm agent capture again.",
    );
  }
  if (!nativeFullscreenAvailable) {
    return new AgentCaptureRefusal(
      "native_capture_unavailable",
      "Agent capture needs native Full screen recording, which this Mac can't use right now.",
    );
  }
  return null;
}

export function richTracksForCapture({
  captureQuality,
  richTracksLabEnabled,
}: {
  captureQuality: CaptureQuality;
  richTracksLabEnabled: boolean;
}): boolean {
  return richTracksLabEnabled && captureQuality === "normal";
}
