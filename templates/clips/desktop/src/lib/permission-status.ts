// Reading and repairing OS privacy grants. Shared by the recorder's readiness
// list and Settings › General › System access so both surfaces report the same
// three states.
import { invoke } from "@tauri-apps/api/core";

import { isMacPlatform } from "./platform";

export type MacosPrivacyPane =
  | "camera"
  | "microphone"
  | "screen"
  | "speech"
  | "accessibility"
  | "input-monitoring";

export type PermissionStatuses = {
  screen: boolean;
  camera: boolean;
  microphone: boolean;
  speech: boolean;
  accessibility: boolean;
  inputMonitoring: boolean;
};

/**
 * `null` means the grants could not be read — a non-macOS host, or the command
 * failing. It is not the same as "denied", and callers must not render it as
 * one: an unreadable grant offers to open System Settings, a denied grant asks
 * the user to fix it.
 */
export async function readPermissionStatuses(): Promise<PermissionStatuses | null> {
  if (!isMacPlatform()) return null;
  try {
    return await invoke<PermissionStatuses>("check_permission_statuses");
  } catch {
    // coercion-ok: null IS the typed "could not read" value — callers render
    // it as unknown, never as denied (locked by permission-status.test.ts).
    return null;
  }
}

export function permissionStatusForPane(
  pane: MacosPrivacyPane,
  statuses: PermissionStatuses | null,
): boolean | null {
  if (!statuses) return null;
  const map: Record<MacosPrivacyPane, boolean> = {
    screen: statuses.screen,
    camera: statuses.camera,
    microphone: statuses.microphone,
    speech: statuses.speech,
    accessibility: statuses.accessibility,
    "input-monitoring": statuses.inputMonitoring,
  };
  return map[pane];
}

/**
 * Screen Recording is the one grant macOS will still prompt for in-app, so try
 * that before sending the user to System Settings. Every other pane only opens.
 */
export async function requestOrOpenPermission(
  pane: MacosPrivacyPane,
  {
    onOpenSettings,
    onRecheck,
  }: {
    onOpenSettings: (pane: MacosPrivacyPane) => void;
    onRecheck?: () => void;
  },
): Promise<void> {
  if (isMacPlatform() && pane === "screen") {
    try {
      const granted = await invoke<boolean>("system_audio_request_permission");
      onRecheck?.();
      if (granted) return;
    } catch {
      // coercion-ok: the request API may be unavailable on an older macOS
      // build, or the user may have denied the prompt once already — falling
      // through to open the dedicated privacy pane IS the recovery path.
    }
  }
  onOpenSettings(pane);
}
