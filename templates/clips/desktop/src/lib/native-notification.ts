import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

export interface NativeNotification {
  title: string;
  body?: string;
}

export interface NativeNotificationDeps {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  sendNotification: (notification: NativeNotification) => void;
}

const tauriNotificationDeps: NativeNotificationDeps = {
  isPermissionGranted,
  requestPermission,
  sendNotification,
};

/**
 * Post an OS notification, requesting permission first when the user has not
 * answered yet. Never rejects: callers await this inside recording stop/retry
 * try blocks, where a throw would be reported as a failed recording.
 */
export async function sendNativeNotification(
  notification: NativeNotification,
  deps: NativeNotificationDeps = tauriNotificationDeps,
): Promise<boolean> {
  try {
    const granted =
      (await deps.isPermissionGranted()) ||
      (await deps.requestPermission()) === "granted";
    if (!granted) return false;
    deps.sendNotification(notification);
    return true;
  } catch (err) {
    console.warn("[clips-tray] native notification failed:", err);
    return false;
  }
}
