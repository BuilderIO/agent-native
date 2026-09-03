import { z } from "zod";

import { emit as emitBusEvent } from "../event-bus/bus.js";
import { registerEvent } from "../event-bus/registry.js";
import type { EventDefinition } from "../event-bus/types.js";
import { truncate } from "../shared/truncate.js";
import { insertNotification, updateDeliveredChannels } from "./store.js";
import {
  NOTIFICATION_SEVERITIES,
  type NotificationChannel,
  type NotificationInput,
  type NotificationMeta,
  type Notification,
} from "./types.js";

export interface NotificationDeliveryResult {
  notification?: Notification;
  deliveredChannels: string[];
}

registerEvent({
  name: "notification.sent",
  description:
    "Fires after notify() delivers to at least one channel. Automations can chain off this — e.g. fan critical notifications to Slack.",
  payloadSchema: z.object({
    notificationId: z.string().optional(),
    severity: z.enum(NOTIFICATION_SEVERITIES),
    title: z.string(),
    body: z.string().optional(),
    deliveredChannels: z.array(z.string()),
  }) as unknown as EventDefinition["payloadSchema"],
  example: {
    notificationId: "ntf_abc",
    severity: "critical",
    title: "Payment failed",
    body: "Card ending 4242 declined",
    deliveredChannels: ["inbox", "webhook"],
  },
});

const REGISTRY_KEY = Symbol.for("@agent-native/core/notifications.registry");
interface GlobalWithRegistry {
  [REGISTRY_KEY]?: Map<string, NotificationChannel>;
}

function getRegistry(): Map<string, NotificationChannel> {
  const g = globalThis as unknown as GlobalWithRegistry;
  if (!g[REGISTRY_KEY]) g[REGISTRY_KEY] = new Map();
  return g[REGISTRY_KEY];
}

export function registerNotificationChannel(
  channel: NotificationChannel,
): void {
  if (!channel?.name) {
    throw new Error("registerNotificationChannel: channel.name is required");
  }
  if (typeof channel.deliver !== "function") {
    throw new Error(
      "registerNotificationChannel: channel.deliver must be a function",
    );
  }
  getRegistry().set(channel.name, channel);
}

export function unregisterNotificationChannel(name: string): boolean {
  return getRegistry().delete(name);
}

export function listNotificationChannels(): string[] {
  return Array.from(getRegistry().keys());
}

/**
 * Deliver a notification.
 *
 * The `inbox` channel always persists a row that drives the in-app UI
 * (bell + toast). Additional channels (webhook, custom) run in parallel,
 * best-effort. Returns the stored Notification when `inbox` ran, otherwise
 * `undefined`.
 *
 * Also emits `notification.sent` on the event bus so automations can react
 * to notifications (e.g. "when a critical notification fires, also page me").
 */
const MAX_TITLE_LEN = 100;
const MAX_BODY_LEN = 2000;

export async function notify(
  input: NotificationInput,
  meta: NotificationMeta,
): Promise<Notification | undefined> {
  return (await notifyWithDelivery(input, meta)).notification;
}

export async function notifyWithDelivery(
  input: NotificationInput,
  meta: NotificationMeta,
): Promise<NotificationDeliveryResult> {
  if (!meta?.owner) {
    throw new Error("notify: meta.owner is required");
  }
  input = {
    ...input,
    title: truncate(input.title, MAX_TITLE_LEN),
    body: truncate(input.body, MAX_BODY_LEN),
  };
  const channels = selectChannels(input.channels);
  const storedMetadata = scrubStoredMetadata(input.metadata);

  // The inbox channel is always included unless explicitly excluded.
  const runInbox = !input.channels || input.channels.includes("inbox");
  const delivered: string[] = [];
  let stored: Notification | undefined;

  if (runInbox) {
    try {
      // Stored with just "inbox" first; the real delivered list is written
      // after fan-out so a failing webhook doesn't claim it was delivered.
      stored = await insertNotification({
        owner: meta.owner,
        severity: input.severity,
        title: input.title,
        body: input.body,
        metadata: storedMetadata,
        deliveredChannels: ["inbox"],
      });
      delivered.push("inbox");
    } catch (err) {
      console.error("[notifications] inbox persist failed:", err);
    }
  }

  // Await every channel so a 500-ing webhook doesn't end up in `delivered`.
  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      const delivered = await channel.deliver(input, meta);
      // Explicit `false` means the channel skipped (no URL / recipients).
      if (delivered === false) return null;
      return channel.name;
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value) delivered.push(r.value);
    } else {
      console.error(
        `[notifications] channel "${channels[i].name}" failed:`,
        r.reason,
      );
    }
  });

  const hasExtraChannel = delivered.some((c) => c !== "inbox");
  if (stored && hasExtraChannel) {
    try {
      await updateDeliveredChannels(stored.id, delivered);
      stored = { ...stored, deliveredChannels: delivered };
    } catch (err) {
      console.error("[notifications] delivered-channel update failed:", err);
    }
  }

  // Only emit when at least one channel delivered — an emission with an
  // empty delivery list (and likely a null notificationId) would mislead
  // any automation chaining off this event.
  if (delivered.length > 0) {
    try {
      emitBusEvent(
        "notification.sent",
        {
          notificationId: stored?.id,
          severity: input.severity,
          title: input.title,
          body: input.body,
          deliveredChannels: delivered,
        },
        { owner: meta.owner },
      );
    } catch {
      // best-effort
    }
  }

  return { notification: stored, deliveredChannels: delivered };
}

function scrubStoredMetadata(
  metadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const entries = Object.entries(metadata).filter(
    ([key]) =>
      key !== "delivery" && key !== "webhookUrl" && key !== "slackWebhookUrl",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function selectChannels(allowlist?: string[]): NotificationChannel[] {
  const registry = getRegistry();
  const all = Array.from(registry.values());
  if (!allowlist) return all;
  return all.filter((c) => allowlist.includes(c.name));
}

/** Test helper — drops all registered channels. */
export function __resetNotificationChannels(): void {
  getRegistry().clear();
}

export {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
  countUnread,
} from "./store.js";
