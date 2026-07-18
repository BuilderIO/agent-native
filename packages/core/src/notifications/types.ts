export const NOTIFICATION_SEVERITIES = ["info", "warning", "critical"] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export interface Notification {
  id: string;
  owner: string;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  /** Arbitrary JSON metadata — URLs, entity ids, the agent turn that produced it. */
  metadata?: Record<string, unknown>;
  /** ISO timestamp */
  createdAt: string;
  /** ISO timestamp — null while unread */
  readAt: string | null;
  /** Channels that delivered (or attempted delivery of) this notification. */
  deliveredChannels: string[];
}

export interface NotificationInput {
  severity: NotificationSeverity;
  title: string;
  body?: string;
  metadata?: Record<string, unknown>;
  /**
   * Explicit channel allowlist for this emission. When omitted, every
   * registered channel runs. Use to scope a single `notify()` call to a
   * subset (e.g. `["inbox"]` to skip webhooks).
   */
  channels?: string[];
}

export interface NotificationMeta {
  /** Owner email — scopes the notification in the inbox. */
  owner: string;
  /** Durable workflow effect whose delivery attempts this notification fulfills. */
  workflowEffectId?: string;
  /** Effect attempt number. Defaults to 1 when a workflow effect is supplied. */
  workflowAttempt?: number;
}

export type NotificationChannelOutcome =
  | {
      /** The provider supplied concrete delivery evidence. */
      status: "delivered";
      evidence: Record<string, unknown>;
    }
  | {
      /** The provider accepted the send but supplied no delivery receipt. */
      status: "unknown";
      evidence?: Record<string, unknown>;
    }
  | { status: "skipped"; reason?: string }
  | { status: "failed"; errorMessage?: string };

export interface NotificationChannel {
  /** Unique channel name, e.g. `"inbox"`, `"webhook"`, `"slack"`. */
  name: string;
  /**
   * Deliver the notification. Must be best-effort — throwing will be logged
   * but will not block other channels from running.
   *
   * Return a structured outcome. `delivered` requires provider evidence;
   * accepted sends without a delivery receipt are `unknown`. Legacy `true`
   * and void returns are conservatively interpreted as `unknown`; `false`
   * is interpreted as `skipped`.
   */
  deliver(
    input: NotificationInput,
    meta: NotificationMeta,
  ):
    | void
    | boolean
    | NotificationChannelOutcome
    | Promise<void | boolean | NotificationChannelOutcome>;
}
