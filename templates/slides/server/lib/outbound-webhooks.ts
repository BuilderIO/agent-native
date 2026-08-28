import { createHmac, randomBytes } from "node:crypto";

import {
  deliverJsonWebhook,
  isWebhookUrlAllowed,
} from "@agent-native/core/integrations";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "@agent-native/core/secrets";
import { fireInternalDispatch } from "@agent-native/core/server";
import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { nanoid } from "nanoid";

import { getDb, schema } from "../db/index.js";

export const SLIDES_WEBHOOK_EVENTS = [
  "deck.created",
  "deck.updated",
  "deck.deleted",
  "comment.added",
  "comment.updated",
] as const;
export type SlidesWebhookEvent = (typeof SLIDES_WEBHOOK_EVENTS)[number];

const MAX_ATTEMPTS = 8;
const MAX_CONSECUTIVE_FAILURES = 5;
const RETRY_BASE_MS = 30_000;
const CLAIM_LEASE_MS = 5 * 60_000;

function now(): string {
  return new Date().toISOString();
}
function nextAttempt(attempts: number): string {
  return new Date(
    Date.now() + RETRY_BASE_MS * 2 ** Math.min(attempts, 6),
  ).toISOString();
}

export async function createWebhookSubscription(input: {
  url: string;
  events: SlidesWebhookEvent[];
  ownerEmail: string;
  orgId: string | null;
}) {
  if (!isWebhookUrlAllowed(input.url))
    throw new Error("Webhook URL is not allowed");
  const id = `wh_${nanoid()}`;
  const secret = randomBytes(32).toString("hex");
  await getDb()
    .insert(schema.webhookSubscriptions)
    .values({
      id,
      url: input.url,
      events: JSON.stringify(input.events),
      secret: encryptSecretValue(secret),
      ownerEmail: input.ownerEmail,
      orgId: input.orgId,
      enabled: true,
      consecutiveFailures: 0,
      createdAt: now(),
      updatedAt: now(),
    });
  return { id, url: input.url, events: input.events, secret };
}

export async function listWebhookSubscriptions(
  ownerEmail: string,
  orgId: string | null,
) {
  return getDb()
    .select({
      id: schema.webhookSubscriptions.id,
      url: schema.webhookSubscriptions.url,
      events: schema.webhookSubscriptions.events,
      enabled: schema.webhookSubscriptions.enabled,
      disabledReason: schema.webhookSubscriptions.disabledReason,
      consecutiveFailures: schema.webhookSubscriptions.consecutiveFailures,
      createdAt: schema.webhookSubscriptions.createdAt,
      updatedAt: schema.webhookSubscriptions.updatedAt,
    })
    .from(schema.webhookSubscriptions)
    .where(
      and(
        eq(schema.webhookSubscriptions.ownerEmail, ownerEmail),
        orgId === null
          ? isNull(schema.webhookSubscriptions.orgId)
          : eq(schema.webhookSubscriptions.orgId, orgId),
      ),
    )
    .orderBy(asc(schema.webhookSubscriptions.createdAt));
}

export async function getWebhookSubscription(
  id: string,
  ownerEmail: string,
  orgId: string | null,
) {
  const rows = await listWebhookSubscriptions(ownerEmail, orgId);
  return rows.find((subscription) => subscription.id === id) ?? null;
}

export async function deleteWebhookSubscription(
  id: string,
  ownerEmail: string,
  orgId: string | null,
) {
  const db = getDb();
  const deleted = await db
    .delete(schema.webhookSubscriptions)
    .where(
      and(
        eq(schema.webhookSubscriptions.id, id),
        eq(schema.webhookSubscriptions.ownerEmail, ownerEmail),
        orgId === null
          ? isNull(schema.webhookSubscriptions.orgId)
          : eq(schema.webhookSubscriptions.orgId, orgId),
      ),
    )
    .returning({ id: schema.webhookSubscriptions.id });
  if (deleted.length) {
    await db
      .update(schema.webhookDeliveries)
      .set({
        status: "cancelled",
        claimedAt: null,
        claimExpiresAt: null,
        updatedAt: now(),
      })
      .where(
        and(
          eq(schema.webhookDeliveries.subscriptionId, id),
          inArray(schema.webhookDeliveries.status, ["pending", "processing"]),
        ),
      );
  }
  return deleted.length > 0;
}

export async function updateWebhookSubscription(input: {
  id: string;
  url?: string;
  events?: SlidesWebhookEvent[];
  enabled?: boolean;
  ownerEmail: string;
  orgId: string | null;
}) {
  if (input.url && !isWebhookUrlAllowed(input.url))
    throw new Error("Webhook URL is not allowed");
  const updated = await getDb()
    .update(schema.webhookSubscriptions)
    .set({
      ...(input.url ? { url: input.url } : {}),
      ...(input.events ? { events: JSON.stringify(input.events) } : {}),
      ...(input.enabled === undefined
        ? {}
        : {
            enabled: input.enabled,
            disabledReason: input.enabled ? null : "Disabled by owner",
          }),
      updatedAt: now(),
    })
    .where(
      and(
        eq(schema.webhookSubscriptions.id, input.id),
        eq(schema.webhookSubscriptions.ownerEmail, input.ownerEmail),
        input.orgId === null
          ? isNull(schema.webhookSubscriptions.orgId)
          : eq(schema.webhookSubscriptions.orgId, input.orgId),
      ),
    )
    .returning({
      id: schema.webhookSubscriptions.id,
      url: schema.webhookSubscriptions.url,
      events: schema.webhookSubscriptions.events,
      enabled: schema.webhookSubscriptions.enabled,
      disabledReason: schema.webhookSubscriptions.disabledReason,
    });
  return updated[0] ?? null;
}

// `scope` must be the deck/comment's own owner+org, never the caller's or an
// unrelated tenant's — fan-out only reaches subscriptions registered under
// that exact tenant, so one tenant's events can never dispatch to another's.
export async function enqueueWebhookEvent(
  event: SlidesWebhookEvent,
  data: unknown,
  scope: { ownerEmail: string; orgId: string | null },
  options?: { db?: any },
) {
  const db = options?.db ?? getDb();
  const subscriptions: Array<typeof schema.webhookSubscriptions.$inferSelect> =
    await db
      .select()
      .from(schema.webhookSubscriptions)
      .where(
        and(
          eq(schema.webhookSubscriptions.enabled, true),
          eq(schema.webhookSubscriptions.ownerEmail, scope.ownerEmail),
          scope.orgId === null
            ? isNull(schema.webhookSubscriptions.orgId)
            : eq(schema.webhookSubscriptions.orgId, scope.orgId),
        ),
      );
  const createdAt = now();
  const payload = JSON.stringify({
    id: `evt_${nanoid()}`,
    event,
    createdAt,
    data,
  });
  const matching = subscriptions.filter((subscription) => {
    try {
      return JSON.parse(subscription.events).includes(event);
    } catch {
      return false;
    }
  });
  if (!matching.length) return [];
  const deliveries = matching.map((subscription) => ({
    id: `whd_${nanoid()}`,
    subscriptionId: subscription.id,
    event,
    payload,
    status: "pending",
    attempts: 0,
    nextAttemptAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  }));
  await db.insert(schema.webhookDeliveries).values(deliveries);
  return deliveries.map((delivery) => delivery.id);
}

async function reclaimExpiredDeliveryLeases() {
  const claimedAt = now();
  await getDb()
    .update(schema.webhookDeliveries)
    .set({
      status: "pending",
      nextAttemptAt: claimedAt,
      claimedAt: null,
      claimExpiresAt: null,
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(schema.webhookDeliveries.status, "processing"),
        or(
          isNull(schema.webhookDeliveries.claimExpiresAt),
          lte(schema.webhookDeliveries.claimExpiresAt, claimedAt),
        ),
      ),
    );
}

async function claimDueDeliveries(limit = 25) {
  const due = await getDb()
    .select()
    .from(schema.webhookDeliveries)
    .where(
      and(
        eq(schema.webhookDeliveries.status, "pending"),
        lte(schema.webhookDeliveries.nextAttemptAt, now()),
      ),
    )
    .orderBy(asc(schema.webhookDeliveries.createdAt))
    .limit(limit);
  const claimed = [];
  for (const delivery of due) {
    const claimedAt = now();
    const result = await getDb()
      .update(schema.webhookDeliveries)
      .set({
        status: "processing",
        attempts: delivery.attempts + 1,
        claimedAt,
        claimExpiresAt: new Date(
          Date.parse(claimedAt) + CLAIM_LEASE_MS,
        ).toISOString(),
        updatedAt: claimedAt,
      })
      .where(
        and(
          eq(schema.webhookDeliveries.id, delivery.id),
          eq(schema.webhookDeliveries.status, "pending"),
        ),
      )
      .returning();
    if (result[0]) claimed.push(result[0]);
  }
  return claimed;
}

export async function dispatchWebhookDeliveries(ids: string[]) {
  if (!ids.length) return;
  await fireInternalDispatch({
    path: "/_agent-native/slides/webhooks/process",
    taskId: ids[0],
  });
}

/** Compatibility helper for writes that cannot share the caller transaction. */
export async function emitWebhookEvent(
  event: SlidesWebhookEvent,
  data: unknown,
  scope: { ownerEmail: string; orgId: string | null },
) {
  const ids = await enqueueWebhookEvent(event, data, scope);
  await dispatchWebhookDeliveries(ids);
  return ids;
}

export async function processDueWebhookDeliveries(limit?: number) {
  // A later self-dispatch or Node recovery sweep releases work abandoned by a
  // terminated serverless invocation; this does not rely on a separate scheduler.
  await reclaimExpiredDeliveryLeases();
  const deliveries = await claimDueDeliveries(limit);
  for (const delivery of deliveries) {
    const [subscription] = await getDb()
      .select()
      .from(schema.webhookSubscriptions)
      .where(eq(schema.webhookSubscriptions.id, delivery.subscriptionId))
      .limit(1);
    if (!subscription || !subscription.enabled) {
      await getDb()
        .update(schema.webhookDeliveries)
        .set({
          status: "cancelled",
          claimedAt: null,
          claimExpiresAt: null,
          updatedAt: now(),
        })
        .where(eq(schema.webhookDeliveries.id, delivery.id));
      continue;
    }
    if (!isWebhookUrlAllowed(subscription.url)) {
      await failDelivery(
        delivery,
        subscription,
        "Webhook URL is no longer allowed",
      );
      continue;
    }
    let secret: string;
    try {
      secret = decryptSecretValue(subscription.secret);
    } catch {
      await failDelivery(
        delivery,
        subscription,
        "Webhook signing secret is unreadable",
      );
      continue;
    }
    const signature = createHmac("sha256", secret)
      .update(delivery.payload)
      .digest("hex");
    const result = await deliverJsonWebhook({
      url: subscription.url,
      serializedBody: delivery.payload,
      headers: { "X-Agent-Native-Signature": `sha256=${signature}` },
    });
    if (result.ok) {
      await getDb()
        .update(schema.webhookDeliveries)
        .set({
          status: "delivered",
          deliveredAt: now(),
          updatedAt: now(),
          lastError: null,
          claimedAt: null,
          claimExpiresAt: null,
        })
        .where(eq(schema.webhookDeliveries.id, delivery.id));
      await getDb()
        .update(schema.webhookSubscriptions)
        .set({ consecutiveFailures: 0, updatedAt: now() })
        .where(eq(schema.webhookSubscriptions.id, subscription.id));
    } else
      await failDelivery(
        delivery,
        subscription,
        result.blocked
          ? "Webhook URL is blocked"
          : `Webhook delivery failed${result.status ? ` with HTTP ${result.status}` : ""}`,
      );
  }
  return deliveries.length;
}

async function failDelivery(
  delivery: typeof schema.webhookDeliveries.$inferSelect,
  subscription: typeof schema.webhookSubscriptions.$inferSelect,
  message: string,
) {
  const failures = subscription.consecutiveFailures + 1;
  const terminal =
    delivery.attempts >= MAX_ATTEMPTS || failures >= MAX_CONSECUTIVE_FAILURES;
  await getDb()
    .update(schema.webhookDeliveries)
    .set({
      status: terminal ? "failed" : "pending",
      nextAttemptAt: terminal ? null : nextAttempt(delivery.attempts),
      lastError: message,
      claimedAt: null,
      claimExpiresAt: null,
      updatedAt: now(),
    })
    .where(eq(schema.webhookDeliveries.id, delivery.id));
  await getDb()
    .update(schema.webhookSubscriptions)
    .set({
      enabled: terminal ? false : subscription.enabled,
      consecutiveFailures: failures,
      disabledReason: terminal
        ? `Disabled after ${failures} consecutive delivery failures: ${message}`
        : subscription.disabledReason,
      updatedAt: now(),
    })
    .where(eq(schema.webhookSubscriptions.id, subscription.id));
}
