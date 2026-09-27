export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export interface Notification {
  id: string;
  owner: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  readAt: string | null;
  deliveredChannels: string[];
}

export interface NotificationInput {
  severity: NotificationSeverity;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  channels?: string[];
}

export interface NotificationMeta {
  owner: string;
}

export interface NotificationChannel {
  name: string;
  deliver(
    input: NotificationInput,
    meta: NotificationMeta,
  ): void | boolean | Promise<void | boolean>;
}
