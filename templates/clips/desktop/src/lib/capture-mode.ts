import {
  normalizeRecorderSetup,
  recorderSetupForCamera,
  recorderSetupForMode,
  type RecorderSetup,
} from "../../../shared/recorder-setup";
import type { CaptureMode } from "./recorder";

export type CaptureSetup = RecorderSetup;

export function normalizeCaptureSetup(
  savedMode: string,
  savedCameraOn: boolean,
): CaptureSetup {
  return normalizeRecorderSetup(savedMode, savedCameraOn);
}

export function captureSetupForMode(mode: CaptureMode): CaptureSetup {
  return recorderSetupForMode(mode);
}

export function captureSetupForCamera(
  mode: CaptureMode,
  cameraOn: boolean,
): CaptureSetup {
  return recorderSetupForCamera(mode, cameraOn);
}
