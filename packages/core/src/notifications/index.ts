export type {
  Notification,
  NotificationSeverity,
  NotificationInput,
  NotificationMeta,
  NotificationChannel,
} from "./types.js";

export {
  notify,
  registerNotificationChannel,
  unregisterNotificationChannel,
  listNotificationChannels,
  listNotifications,
  countUnread,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
} from "./registry.js";

export { registerBuiltinNotificationChannels } from "./channels.js";
