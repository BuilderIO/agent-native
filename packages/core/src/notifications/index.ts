export type {
  Notification,
  NotificationSeverity,
  NotificationInput,
  NotificationMeta,
  NotificationChannel,
} from "./types.js";

export {
  notify,
  notifyWithDelivery,
  registerNotificationChannel,
  unregisterNotificationChannel,
  listNotificationChannels,
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  setNotificationArchived,
  archiveNotifications,
} from "./registry.js";

export type { NotificationArchiveScope } from "./store.js";

export { registerBuiltinNotificationChannels } from "./channels.js";

// Inbox-only access for workflows that must not fan out to registered channels.
export {
  ensureTable as ensureInboxReady,
  insertNotification as insertInboxNotification,
} from "./store.js";
