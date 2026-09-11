import type { ComputerPermissionStatus } from "./types";

interface MacSystemPreferences {
  getMediaAccessStatus(
    mediaType: "screen",
  ): ComputerPermissionStatus["screenRecording"];
  isTrustedAccessibilityClient(prompt: boolean): boolean;
}

export function getComputerPermissionStatus(
  systemPreferences: MacSystemPreferences,
): ComputerPermissionStatus {
  return {
    screenRecording: systemPreferences.getMediaAccessStatus("screen"),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false),
  };
}

export function requestAccessibilityPermission(
  systemPreferences: MacSystemPreferences,
): boolean {
  return systemPreferences.isTrustedAccessibilityClient(true);
}
