/**
 * ACCOUNT > Notifications > "Desktop notifications" (the source's first item in
 * that section, settings item catalogue five chunk 298c12dc3434 lines 788-799).
 *
 * The switch used to persist a value nothing read, so flipping it changed
 * nothing a person could observe. This module is the reader: a notebook run that
 * finishes while the tab is in the background raises a browser notification when
 * the switch is on.
 */

import {
  useResource,
  useResources,
} from "@agent-native/core/client/resources/use-resources";

/** Where the signed-in person's notification choices live. */
export const NOTIFICATIONS_RESOURCE_PATH = "settings/notifications.json";

export interface DesktopNotificationSettings {
  desktopNotifications: boolean;
}

export const DEFAULT_DESKTOP_NOTIFICATION_SETTINGS: DesktopNotificationSettings =
  { desktopNotifications: false };

/** Reads the switch out of the stored settings resource, defaulting to off. */
export function parseDesktopNotificationSettings(
  content: string | undefined,
): DesktopNotificationSettings {
  if (!content) return DEFAULT_DESKTOP_NOTIFICATION_SETTINGS;
  try {
    const parsed = JSON.parse(content) as {
      desktopNotifications?: unknown;
    };
    return {
      desktopNotifications:
        typeof parsed.desktopNotifications === "boolean"
          ? parsed.desktopNotifications
          : DEFAULT_DESKTOP_NOTIFICATION_SETTINGS.desktopNotifications,
    };
  } catch {
    return DEFAULT_DESKTOP_NOTIFICATION_SETTINGS;
  }
}

export interface RunFinishedNotice {
  /** The switch's current value, read from the person's settings. */
  enabled: boolean;
  title: string;
  body: string;
  /** Defaults to the document's own visibility. */
  hidden?: boolean;
  /** Defaults to the browser's Notification constructor. */
  show?: (title: string, body: string) => void;
  /** Defaults to the browser's permission state. */
  permission?: NotificationPermission;
}

/**
 * Shows one notification for a finished background run, and says whether it did.
 *
 * A run that finishes while the person is looking at the notebook already shows
 * its result in place, so nothing is raised there; the same is true when the
 * switch is off, when the browser has no Notification support and when the
 * person refused permission. Nothing here asks for permission: the switch does
 * that when it is turned on, where the click makes the prompt expected.
 */
export function notifyRunFinished({
  enabled,
  title,
  body,
  hidden = typeof document !== "undefined" &&
    document.visibilityState === "hidden",
  show,
  permission,
}: RunFinishedNotice): boolean {
  if (!enabled || !hidden) return false;
  if (permission != null && permission !== "granted") return false;
  const renderer =
    show ??
    (typeof Notification === "undefined"
      ? undefined
      : (heading: string, text: string) => {
          new Notification(heading, { body: text });
        });
  if (renderer == null) return false;
  renderer(title, body);
  return true;
}

/** The switch's live value, read from the person's own settings resource. */
export function useDesktopNotificationsEnabled(): boolean {
  const list = useResources("personal");
  const meta = list.data?.find(
    (resource) => resource.path === NOTIFICATIONS_RESOURCE_PATH,
  );
  const resource = useResource(meta?.id ?? null);
  return parseDesktopNotificationSettings(resource.data?.content)
    .desktopNotifications;
}

/**
 * Asks the browser for notification permission. Called from the switch's own
 * click, which is where a permission prompt is expected; a browser without the
 * API, or a person who already refused, simply leaves the switch backed by
 * nothing until Settings is changed again.
 */
export async function requestDesktopNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}
