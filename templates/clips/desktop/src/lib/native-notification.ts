import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification";

export interface NativeNotification {
  title: string;
  body?: string;
}

export interface NativeNotificationDeps {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<NotificationPermission>;
  sendNotification: (notification: NativeNotification) => void | Promise<void>;
}

const tauriNotificationDeps: NativeNotificationDeps = {
  isPermissionGranted,
  requestPermission,
  sendNotification: (notification) =>
    invoke<void>("plugin:notification|notify", { options: notification }),
};

export type NativeNotificationResult =
  | { status: "submitted"; visibility: "unknown" }
  | { status: "denied" }
  | {
      status: "failed";
      stage: "permission" | "dispatch";
      reason: "backend" | "timeout";
    };

const NOTIFICATION_TIMEOUT_MS = 5_000;

class NotificationTimeoutError extends Error {}

async function boundedNotificationOperation<T>(
  operation: () => Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new NotificationTimeoutError()),
          NOTIFICATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Failure delivery never prompts for permission or claims OS presentation. */
export async function submitNativeNotification(
  notification: NativeNotification,
  deps: NativeNotificationDeps = tauriNotificationDeps,
): Promise<NativeNotificationResult> {
  let stage: "permission" | "dispatch" = "permission";
  try {
    const granted = await boundedNotificationOperation(
      deps.isPermissionGranted,
    );
    if (!granted) return { status: "denied" };
    stage = "dispatch";
    await boundedNotificationOperation(async () => {
      await deps.sendNotification({
        title: notification.title,
        body: notification.body,
      });
    });
    // Desktop plugin permission checks cannot see Focus/OS suppression, and
    // its backend queues delivery without acknowledging notification display.
    return { status: "submitted", visibility: "unknown" };
  } catch (error) {
    return {
      status: "failed",
      stage,
      reason: error instanceof NotificationTimeoutError ? "timeout" : "backend",
    };
  }
}

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
    await deps.sendNotification(notification);
    return true;
  } catch (err) {
    console.warn("[clips-tray] native notification failed:", err);
    return false;
  }
}
