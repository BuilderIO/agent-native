import type { CaptureMode, CaptureSource } from "./recorder";

// The "Ready to record" panel runs in its own window. The popover owns the
// camera, microphone and system-audio choices, so the two windows trade them
// over these events. Cursor effects persist in the native app instead.
export const READY_TO_RECORD_EVENTS = {
  requestState: "clips:ready-to-record-request-state",
  state: "clips:ready-to-record-state",
  toggle: "clips:ready-to-record-toggle",
  start: "clips:ready-to-record-start",
  cancel: "clips:ready-to-record-cancel",
} as const;

export type ReadyToRecordToggle = "camera" | "mic" | "systemAudio";

export interface ReadyToRecordState {
  mode: CaptureMode;
  source: CaptureSource;
  cameraOn: boolean;
  cameraLabel: string;
  micOn: boolean;
  micLabel: string;
  systemAudioOn: boolean;
}

export interface CursorEffectsConfig {
  highlightEnabled: boolean;
  clickEnabled: boolean;
  highlightColor: string;
  clickColor: string;
  secondaryClickColor: string;
}

// Snagit 2026 defaults: yellow highlight, coral left click, blue right click.
export const DEFAULT_CURSOR_EFFECTS: CursorEffectsConfig = {
  highlightEnabled: true,
  clickEnabled: true,
  // guard:allow-raw-color — effect colour stored as user data, not styling
  highlightColor: "#FFFF00",
  // guard:allow-raw-color — effect colour stored as user data, not styling
  clickColor: "#FF594B",
  // guard:allow-raw-color — effect colour stored as user data, not styling
  secondaryClickColor: "#1DB1FC",
};

export type CursorEffectsAvailability =
  | { available: true }
  | { available: false; reason: string };

export function cursorEffectsAvailability(
  state: Pick<ReadyToRecordState, "mode" | "source">,
): CursorEffectsAvailability {
  if (state.mode === "camera") {
    return {
      available: false,
      reason: "Cursor effects need a screen recording.",
    };
  }
  if (state.source === "window") {
    return {
      available: false,
      reason: "Cursor effects are disabled for Window captures.",
    };
  }
  return { available: true };
}

export function cursorEffectsOn(config: CursorEffectsConfig): boolean {
  return config.highlightEnabled || config.clickEnabled;
}

export function onOffLabel(on: boolean): "On" | "Off" {
  return on ? "On" : "Off";
}

export function applyReadyToRecordToggle(
  state: ReadyToRecordState,
  toggle: ReadyToRecordToggle,
): ReadyToRecordState {
  switch (toggle) {
    case "camera":
      return { ...state, cameraOn: !state.cameraOn };
    case "mic":
      return { ...state, micOn: !state.micOn };
    case "systemAudio":
      return { ...state, systemAudioOn: !state.systemAudioOn };
  }
}

export function isReadyToRecordToggle(
  value: unknown,
): value is ReadyToRecordToggle {
  return value === "camera" || value === "mic" || value === "systemAudio";
}

export function sourceLabel(source: CaptureSource): string {
  switch (source) {
    case "full-screen":
      return "Full screen";
    case "window":
      return "Window";
    case "region":
      return "Region";
  }
}
