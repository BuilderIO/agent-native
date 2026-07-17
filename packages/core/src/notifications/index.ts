export type {
  Notification,
  NotificationSeverity,
  NotificationInput,
  NotificationMeta,
  NotificationChannel,
  NotificationChannelOutcome,
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
  type NotificationDeliveryResult,
  type NotificationChannelDeliveryOutcome,
} from "./registry.js";

export { registerBuiltinNotificationChannels } from "./channels.js";

export {
  DEFAULT_PERSONAL_NOTIFICATION_ROUTING,
  getPersonalNotificationRouting,
  setPersonalNotificationRouting,
  notifyPersonalWithDelivery,
  normalizePersonalNotificationRouting,
  type PersonalNotificationRouting,
} from "./routing.js";
