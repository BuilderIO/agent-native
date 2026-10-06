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
