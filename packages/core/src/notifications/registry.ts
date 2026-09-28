import { z } from "zod";

import { emit as emitBusEvent } from "../event-bus/bus.js";
import { registerEvent } from "../event-bus/registry.js";
import type { EventDefinition } from "../event-bus/types.js";
import { truncate } from "../shared/truncate.js";
import {
  addDeliveredChannel,
  claimNotificationDelivery,
  completeNotificationDelivery,
  insertNotification,
  listCompletedNotificationChannels,
  notificationIdForIdempotencyKey,
  releaseNotificationDelivery,
} from "./store.js";
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

const MAX_TITLE_LEN = 100;
const MAX_BODY_LEN = 2000;

export async function notify(
  input: NotificationInput,
  meta: NotificationMeta,
  options?: { signal?: AbortSignal },
): Promise<Notification | undefined> {
  return (await notifyWithDelivery(input, meta, options)).notification;
}

export async function notifyWithDelivery(
  input: NotificationInput,
  meta: NotificationMeta,
  options?: { signal?: AbortSignal },
): Promise<NotificationDeliveryResult> {
  const signal = options?.signal;
  signal?.throwIfAborted();
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

  const runInbox = !input.channels || input.channels.includes("inbox");
  let stored: Notification | undefined;

  if (runInbox) {
    try {
      signal?.throwIfAborted();
      stored = await insertNotification({
        owner: meta.owner,
        severity: input.severity,
        title: input.title,
        body: input.body,
        metadata: storedMetadata,
        deliveredChannels: ["inbox"],
        idempotencyKey: input.idempotencyKey,
      });
    } catch (err) {
      if (signal?.aborted) signal.throwIfAborted();
      console.error("[notifications] inbox persist failed:", err);
    }
  }

  // DbExec cannot cancel an in-flight INSERT, so stop before fan-out and event emission.
  signal?.throwIfAborted();

  const deliveryId = input.idempotencyKey
    ? notificationIdForIdempotencyKey(meta.owner, input.idempotencyKey)
    : undefined;
  const previouslyDelivered = new Set<string>([
    ...(stored?.deliveredChannels ?? []),
    ...(deliveryId ? await listCompletedNotificationChannels(deliveryId) : []),
  ]);
  if (stored) previouslyDelivered.add("inbox");
  const delivered = Array.from(previouslyDelivered);

  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      signal?.throwIfAborted();
      if (previouslyDelivered.has(channel.name)) return null;

      const claimToken = deliveryId
        ? await claimNotificationDelivery(deliveryId, channel.name)
        : undefined;
      if (deliveryId && !claimToken) return null;

      let deliveryCompleted = false;
      try {
        signal?.throwIfAborted();
        const result = signal
          ? await channel.deliver(input, meta, { signal })
          : await channel.deliver(input, meta);
        if (result === false) {
          if (claimToken) {
            await releaseNotificationDelivery(
              deliveryId!,
              channel.name,
              claimToken,
            );
          }
          return null;
        }

        // Persist each successful side effect before observing a later abort.
        // A sweep retry can then skip this channel even if the run itself aborts.
        deliveryCompleted = true;
        if (claimToken) {
          await completeNotificationDelivery(
            deliveryId!,
            channel.name,
            claimToken,
          );
        }
        if (stored) {
          try {
            await addDeliveredChannel(stored.id, channel.name);
          } catch (err) {
            console.error(
              "[notifications] delivered-channel update failed:",
              err,
            );
          }
        }
        return channel.name;
      } catch (err) {
        if (claimToken && !deliveryCompleted) {
          try {
            await releaseNotificationDelivery(
              deliveryId!,
              channel.name,
              claimToken,
            );
          } catch (releaseErr) {
            console.error(
              `[notifications] channel "${channel.name}" claim release failed:`,
              releaseErr,
            );
          }
        }
        throw err;
      }
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

  if (deliveryId) {
    for (const channel of await listCompletedNotificationChannels(deliveryId)) {
      if (!delivered.includes(channel)) delivered.push(channel);
    }
  }
  if (stored) stored = { ...stored, deliveredChannels: delivered };

  if (delivered.length > 0) {
    const eventClaim = deliveryId
      ? await claimNotificationDelivery(
          deliveryId,
          "notification.sent",
          "event",
        )
      : undefined;
    try {
      if (!deliveryId || eventClaim) {
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
        if (deliveryId && eventClaim) {
          await completeNotificationDelivery(
            deliveryId,
            "notification.sent",
            eventClaim,
            "event",
          );
        }
      }
    } catch {
      if (deliveryId && eventClaim) {
        try {
          await releaseNotificationDelivery(
            deliveryId,
            "notification.sent",
            eventClaim,
            "event",
          );
        } catch {
          // best-effort
        }
      }
      // Event delivery is best-effort.
    }
  }

  // The channel completion and event receipt are durable before cancellation
  // escapes to the sweep runner.
  signal?.throwIfAborted();

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
