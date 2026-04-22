import { z } from "zod";
import {
  NOTIFICATION_SEVERITIES,
  type NotificationChannel,
  type NotificationInput,
  type NotificationMeta,
  type Notification,
} from "./types.js";
import { insertNotification } from "./store.js";
import { emit as emitBusEvent } from "../event-bus/bus.js";
import { registerEvent } from "../event-bus/registry.js";
import type { EventDefinition } from "../event-bus/types.js";

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
export async function notify(
  input: NotificationInput,
  meta: NotificationMeta,
): Promise<Notification | undefined> {
  if (!meta?.owner) {
    throw new Error("notify: meta.owner is required");
  }
  const channels = selectChannels(input.channels);

  // The inbox channel is always included unless explicitly excluded.
  const runInbox = !input.channels || input.channels.includes("inbox");
  const delivered: string[] = [];
  let stored: Notification | undefined;

  if (runInbox) {
    try {
      stored = await insertNotification({
        owner: meta.owner,
        severity: input.severity,
        title: input.title,
        body: input.body,
        metadata: input.metadata,
        deliveredChannels: channels.map((c) => c.name).concat("inbox"),
      });
      delivered.push("inbox");
    } catch (err) {
      console.error("[notifications] inbox persist failed:", err);
    }
  }

  // Fan out to registered channels (best-effort).
  for (const channel of channels) {
    try {
      const result = channel.deliver(input, meta);
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch((err) => {
          console.error(
            `[notifications] channel "${channel.name}" rejected:`,
            err,
          );
        });
      }
      delivered.push(channel.name);
    } catch (err) {
      console.error(`[notifications] channel "${channel.name}" threw:`, err);
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

  return stored;
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
