import type { CameraBubbleSize } from "@/components/recorder/camera-bubble";
import type {
  DisplaySurface,
  RecordingMode,
} from "@/components/recorder/recorder-engine";
import { MAX_BLUR_PX, MIN_BLUR_PX } from "@/lib/camera-blur";

/**
 * Last-used recorder selections, remembered across `/record` visits via
 * localStorage so the panel doesn't reset to defaults every time. Device ids
 * are best-effort: a remembered mic/camera that no longer exists (machine
 * changed, permission revoked) falls back to "default" in the panel, so we
 * never feed a stale `deviceId: { exact }` to getUserMedia.
 *
 * `?mode=` / `?surface=` URL params still win over a saved preference — those
 * are explicit deep-link intents (e.g. the agent navigating to a specific
 * capture mode).
 */
export interface RecorderPreferences {
  mode: RecordingMode;
  displaySurface: DisplaySurface;
  micId: string;
  cameraId: string;
  cameraSize: CameraBubbleSize;
  cameraBlur: boolean;
  cameraBlurRadius: number;
}

const STORAGE_KEY = "clips:recorder-preferences";

const VALID_MODES: RecordingMode[] = ["screen", "camera", "screen+camera"];
const VALID_SURFACES: DisplaySurface[] = ["monitor", "window", "browser"];
const VALID_SIZES: CameraBubbleSize[] = ["sm", "md", "lg"];

export function loadRecorderPreferences(): Partial<RecorderPreferences> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const prefs: Partial<RecorderPreferences> = {};
    if (VALID_MODES.includes(parsed.mode as RecordingMode)) {
      prefs.mode = parsed.mode as RecordingMode;
    }
    if (VALID_SURFACES.includes(parsed.displaySurface as DisplaySurface)) {
      prefs.displaySurface = parsed.displaySurface as DisplaySurface;
    }
    if (typeof parsed.micId === "string") prefs.micId = parsed.micId;
    if (typeof parsed.cameraId === "string") prefs.cameraId = parsed.cameraId;
    if (VALID_SIZES.includes(parsed.cameraSize as CameraBubbleSize)) {
      prefs.cameraSize = parsed.cameraSize as CameraBubbleSize;
    }
    if (typeof parsed.cameraBlur === "boolean") {
      prefs.cameraBlur = parsed.cameraBlur;
    }
    if (
      typeof parsed.cameraBlurRadius === "number" &&
      Number.isFinite(parsed.cameraBlurRadius)
    ) {
      prefs.cameraBlurRadius = Math.min(
        MAX_BLUR_PX,
        Math.max(MIN_BLUR_PX, parsed.cameraBlurRadius),
      );
    }
    return prefs;
  } catch {
    return {};
  }
}

export function saveRecorderPreferences(
  patch: Partial<RecorderPreferences>,
): void {
  if (typeof window === "undefined") return;
  try {
    const next = { ...loadRecorderPreferences(), ...patch };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage may be unavailable (private mode, quota) — preferences are
    // a nicety, never block recording on a write failure.
  }
}
