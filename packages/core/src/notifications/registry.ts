import { z } from "zod";

import { emit as emitBusEvent } from "../event-bus/bus.js";
import { registerEvent } from "../event-bus/registry.js";
import type { EventDefinition } from "../event-bus/types.js";
import { truncate } from "../shared/truncate.js";
import { recordNotificationDeliveryAttempt } from "../workflow/store.js";
import type { WorkflowDeliveryStatus } from "../workflow/types.js";
import { insertNotification, updateDeliveredChannels } from "./store.js";
import {
  NOTIFICATION_SEVERITIES,
  type NotificationChannel,
  type NotificationInput,
  type NotificationMeta,
  type Notification,
  type NotificationChannelOutcome,
} from "./types.js";

export interface NotificationChannelDeliveryOutcome {
  channel: string;
  status: "delivered" | "unknown" | "skipped" | "failed";
  evidence?: Record<string, unknown>;
  errorMessage?: string;
}

export interface NotificationDeliveryResult {
  notification?: Notification;
  deliveredChannels: string[];
  unknownChannels: string[];
  skippedChannels: string[];
  failedChannels: string[];
  channelOutcomes: NotificationChannelDeliveryOutcome[];
}

registerEvent({
  name: "notification.sent",
  description:
    "Fires after notify() delivers to or is accepted by at least one channel. Automations can chain off this — e.g. fan critical notifications to Slack.",
  payloadSchema: z.object({
    notificationId: z.string().optional(),
    severity: z.enum(NOTIFICATION_SEVERITIES),
    title: z.string(),
    body: z.string().optional(),
    deliveredChannels: z.array(z.string()),
    unknownChannels: z.array(z.string()),
  }) as unknown as EventDefinition["payloadSchema"],
  example: {
    notificationId: "ntf_abc",
    severity: "critical",
    title: "Payment failed",
    body: "Card ending 4242 declined",
    deliveredChannels: ["inbox", "webhook"],
    unknownChannels: [],
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
  const outcomes: NotificationChannelDeliveryOutcome[] = [];
  let stored: Notification | undefined;

  if (runInbox) {
    await recordDelivery(meta, "inbox", "unknown");
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
      outcomes.push({
        channel: "inbox",
        status: "delivered",
        evidence: { notificationId: stored.id },
      });
      await recordDelivery(meta, "inbox", "delivered", stored.id);
    } catch (err) {
      if (err instanceof WorkflowDeliveryLedgerError) throw err;
      console.error("[notifications] inbox persist failed:", err);
      await recordDelivery(meta, "inbox", "failed", undefined, err);
      outcomes.push({
        channel: "inbox",
        status: "failed",
        errorMessage: errorMessage(err),
      });
    }
  }

  // Await every channel so a 500-ing webhook doesn't end up in `delivered`.
  const results = await Promise.allSettled(
    channels.map(async (channel) => {
      await recordDelivery(meta, channel.name, "unknown", stored?.id);
      try {
        const rawOutcome = await channel.deliver(input, meta);
        const outcome = normalizeChannelOutcome(channel.name, rawOutcome);
        await recordDelivery(
          meta,
          channel.name,
          outcome.status,
          stored?.id,
          outcome.errorMessage,
        );
        return outcome;
      } catch (error) {
        if (error instanceof WorkflowDeliveryLedgerError) throw error;
        await recordDelivery(meta, channel.name, "failed", stored?.id, error);
        return {
          channel: channel.name,
          status: "failed" as const,
          errorMessage: errorMessage(error),
        };
      }
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      outcomes.push(r.value);
    } else {
      console.error(
        `[notifications] channel "${channels[i].name}" failed:`,
        r.reason,
      );
    }
  });
  const ledgerFailure = results.find(
    (result) =>
      result.status === "rejected" &&
      result.reason instanceof WorkflowDeliveryLedgerError,
  );
  if (ledgerFailure?.status === "rejected") throw ledgerFailure.reason;

  const delivered = channelsForStatus(outcomes, "delivered");
  const unknown = channelsForStatus(outcomes, "unknown");
  const skipped = channelsForStatus(outcomes, "skipped");
  const failed = channelsForStatus(outcomes, "failed");

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
  if (delivered.length > 0 || unknown.length > 0) {
    try {
      emitBusEvent(
        "notification.sent",
        {
          notificationId: stored?.id,
          severity: input.severity,
          title: input.title,
          body: input.body,
          deliveredChannels: delivered,
          unknownChannels: unknown,
        },
        { owner: meta.owner },
      );
    } catch {
      // best-effort
    }
  }

  return {
    notification: stored,
    deliveredChannels: delivered,
    unknownChannels: unknown,
    skippedChannels: skipped,
    failedChannels: failed,
    channelOutcomes: outcomes,
  };
}

async function recordDelivery(
  meta: NotificationMeta,
  channel: string,
  status: WorkflowDeliveryStatus,
  notificationId?: string,
  error?: unknown,
): Promise<void> {
  if (!meta.workflowEffectId) return;
  try {
    await recordNotificationDeliveryAttempt({
      effectId: meta.workflowEffectId,
      notificationId,
      channel,
      attempt: meta.workflowAttempt ?? 1,
      status,
      errorMessage:
        error == null
          ? undefined
          : error instanceof Error
            ? error.message
            : String(error),
    });
  } catch (ledgerError) {
    throw new WorkflowDeliveryLedgerError(channel, ledgerError);
  }
}

function normalizeChannelOutcome(
  channel: string,
  outcome: void | boolean | NotificationChannelOutcome,
): NotificationChannelDeliveryOutcome {
  if (outcome === false) return { channel, status: "skipped" };
  if (outcome == null || outcome === true) {
    return { channel, status: "unknown" };
  }
  if (outcome.status === "delivered") {
    if (Object.keys(outcome.evidence).length === 0) {
      return { channel, status: "unknown" };
    }
    return { channel, status: "delivered", evidence: outcome.evidence };
  }
  if (outcome.status === "unknown") {
    return { channel, status: "unknown", evidence: outcome.evidence };
  }
  if (outcome.status === "skipped") {
    return {
      channel,
      status: "skipped",
      errorMessage: outcome.reason,
    };
  }
  return {
    channel,
    status: "failed",
    errorMessage: outcome.errorMessage,
  };
}

function channelsForStatus(
  outcomes: NotificationChannelDeliveryOutcome[],
  status: NotificationChannelDeliveryOutcome["status"],
): string[] {
  return outcomes
    .filter((outcome) => outcome.status === status)
    .map((outcome) => outcome.channel);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class WorkflowDeliveryLedgerError extends Error {
  constructor(channel: string, cause: unknown) {
    super(`Notification delivery ledger failed for channel "${channel}"`, {
      cause,
    });
    this.name = "WorkflowDeliveryLedgerError";
  }
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
