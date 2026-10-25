import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import {
  isBlockedExtensionUrl,
  ssrfSafeFetch,
} from "@agent-native/core/extensions/url-safety";
import {
  deleteAppSecret,
  readAppSecret,
  type SecretRef,
} from "@agent-native/core/secrets";
import { platformWaitUntil } from "@agent-native/core/server";
import {
  getRequestRunContext,
  getRequestUserEmail,
  runWithRequestContext,
} from "@agent-native/core/server/request-context";
import {
  assertAccess,
  ForbiddenError,
  resolveAccess,
} from "@agent-native/core/sharing";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  notExists,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import { contentWebhookHeaders } from "../server/lib/content-webhook-signature.js";
import {
  parsePropertyOptions,
  parsePropertyValue,
  type DocumentPropertyValue,
} from "../shared/properties.js";
import { getDatabaseById } from "./_property-utils.js";

type Db = ReturnType<typeof getDb>;

export const CONTENT_WEBHOOK_EVENT_TYPES = [
  "property.changed",
  "comment.created",
  "comment.resolved",
] as const;
export type ContentWebhookEventType =
  (typeof CONTENT_WEBHOOK_EVENT_TYPES)[number];

export type ContentWebhookScopeType = "database" | "document";

export interface ContentChangeActor {
  kind: "human" | "agent";
  email: string | null;
}

/**
 * Waits between attempts: the first retry 10 s after the first failure, the
 * last about 28 hours after the change. A delivery that fails every attempt is
 * marked failed and kept for inspection.
 */
export const CONTENT_WEBHOOK_RETRY_DELAYS_MS = [
  10_000,
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  5 * 60 * 60_000,
  10 * 60 * 60_000,
  10 * 60 * 60_000,
] as const;
export const CONTENT_WEBHOOK_MAX_ATTEMPTS =
  CONTENT_WEBHOOK_RETRY_DELAYS_MS.length + 1;
const DELIVERY_TIMEOUT_MS = 10_000;
const LEASE_MS = 60_000;
const CLAIM_BATCH = 20;
/**
 * At most this many of one webhook's deliveries per claim, so one busy webhook
 * can't fill a batch. A webhook's deliveries go one at a time, in sequence
 * order, but a retried delivery can arrive after later ones; receivers order
 * by `sequence`, as the skill says.
 */
const PER_WEBHOOK_BATCH = 3;
/** Rows per insert: 11 bound values each, far below Postgres's 65,535. */
const INSERT_CHUNK = 500;
const DELIVERED_RETENTION_MS = 7 * 24 * 60 * 60_000;
const FAILED_RETENTION_MS = 30 * 24 * 60 * 60_000;
/** Rows per purge statement, and statements per sweep; the next sweep goes on. */
const PURGE_BATCH = 1_000;
const PURGE_MAX_BATCHES = 20;
/** Webhooks of deleted pages and collections removed per sweep. */
const ORPHAN_BATCH = 100;
const MAX_VALUE_CHARS = 16_000;
const MAX_COMMENT_CHARS = 2_000;
const AGENT_CALLERS = new Set(["tool", "mcp", "webmcp", "a2a"]);

export function contentWebhookSecretRef(webhook: {
  secretKey: string;
  secretScope: string;
  secretScopeId: string;
}): SecretRef {
  return {
    key: webhook.secretKey,
    scope: webhook.secretScope as SecretRef["scope"],
    scopeId: webhook.secretScopeId,
  };
}

/** Who made a change: the signed-in person, and whether an agent did it for them. */
export function contentChangeActor(
  ctx?: Pick<ActionRunContext, "caller" | "userEmail">,
): ContentChangeActor {
  const email =
    (ctx?.userEmail ?? getRequestUserEmail())?.trim().toLowerCase() || null;
  const agent =
    Boolean(getRequestRunContext()?.runId) ||
    (ctx?.caller !== undefined && AGENT_CALLERS.has(ctx.caller));
  return { kind: agent ? "agent" : "human", email };
}

interface DeliveryScope {
  actor: ContentChangeActor;
  enqueued: boolean;
}

const deliveryScope = new AsyncLocalStorage<DeliveryScope>();

/**
 * Runs one action's writes so the events they enqueue name the action's caller
 * and are sent as soon as the action's transactions have committed. Nested
 * actions share the outermost scope, which sends once at the end. An event
 * enqueued outside any scope still goes out on the next recurring sweep.
 */
export async function withContentWebhookDelivery<T>(
  ctx: Pick<ActionRunContext, "caller" | "userEmail"> | undefined,
  run: () => Promise<T>,
): Promise<T> {
  if (deliveryScope.getStore()) return run();
  const scope: DeliveryScope = {
    actor: contentChangeActor(ctx),
    enqueued: false,
  };
  const result = await deliveryScope.run(scope, run);
  if (scope.enqueued) scheduleContentWebhookDelivery();
  return result;
}

function currentActor(): ContentChangeActor {
  return deliveryScope.getStore()?.actor ?? contentChangeActor();
}

/** Sends due deliveries after the response, while the database is awake. */
export function scheduleContentWebhookDelivery(): void {
  const work = drainContentWebhookDeliveries({
    deadlineAt: Date.now() + 30_000,
  }).catch((error) => {
    console.warn(
      "[content-webhooks] immediate delivery failed; the sweep will retry:",
      error instanceof Error ? error.message : String(error),
    );
  });
  const waitUntil = getRequestRunContext()?.waitUntil ?? platformWaitUntil();
  if (waitUntil) waitUntil(work);
}

type WebhookRow = typeof schema.contentWebhooks.$inferSelect;

/**
 * Only create-content-webhook writes these columns, from validated arrays, so
 * anything else is corruption. It throws rather than reading as "no filter",
 * which would widen a property filter to every property.
 */
function parseStringArray(json: string | null): string[] | null {
  if (json === null) return null;
  const parsed: unknown = JSON.parse(json);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    // guard:allow-bare-error — invariant: only create-content-webhook writes this column, from a validated array
    throw new Error("A stored webhook filter is not a list of strings.");
  }
  return parsed;
}

export function webhookEvents(webhook: Pick<WebhookRow, "eventsJson">) {
  return (parseStringArray(webhook.eventsJson) ?? []).filter(
    (event): event is ContentWebhookEventType =>
      (CONTENT_WEBHOOK_EVENT_TYPES as readonly string[]).includes(event),
  );
}

export function webhookPropertyIds(
  webhook: Pick<WebhookRow, "propertyIdsJson">,
) {
  return parseStringArray(webhook.propertyIdsJson);
}

async function webhooksForDocuments(
  db: Db,
  documentIds: string[],
  databaseIds: string[],
): Promise<WebhookRow[]> {
  const hooks = schema.contentWebhooks;
  return db
    .select()
    .from(hooks)
    .where(
      or(
        and(
          eq(hooks.scopeType, "document"),
          inArray(hooks.scopeId, documentIds),
        ),
        databaseIds.length
          ? and(
              eq(hooks.scopeType, "database"),
              inArray(hooks.scopeId, databaseIds),
            )
          : undefined,
      ),
    );
}

async function insertDeliveries(
  db: Db,
  rows: Array<{
    webhookId: string;
    eventType: ContentWebhookEventType;
    documentId: string;
    databaseId: string | null;
    payload: Record<string, unknown>;
  }>,
  now: string,
) {
  if (!rows.length) return 0;
  const values = rows.map((row) => ({
    id: `evt_${randomUUID().replace(/-/g, "")}`,
    webhookId: row.webhookId,
    eventType: row.eventType,
    documentId: row.documentId,
    databaseId: row.databaseId,
    payloadJson: JSON.stringify(row.payload),
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  }));
  // A 250-row patch fans out to rows × changed properties × webhooks.
  for (let start = 0; start < values.length; start += INSERT_CHUNK) {
    await db
      .insert(schema.contentWebhookDeliveries)
      .values(values.slice(start, start + INSERT_CHUNK));
  }
  const scope = deliveryScope.getStore();
  if (scope) scope.enqueued = true;
  return rows.length;
}

function overLimit(value: DocumentPropertyValue): boolean {
  return typeof value === "string" && value.length > MAX_VALUE_CHARS;
}

function boundedValue(value: DocumentPropertyValue): DocumentPropertyValue {
  return overLimit(value) ? (value as string).slice(0, MAX_VALUE_CHARS) : value;
}

/** The option names a select, status, or multi-select value stands for. */
function optionLabel(
  definition: { type: string; optionsJson: string | null },
  value: DocumentPropertyValue,
): string | string[] | null {
  if (!["select", "status", "multi_select"].includes(definition.type)) {
    return null;
  }
  const options = parsePropertyOptions(definition.optionsJson).options ?? [];
  const label = (candidate: unknown) => {
    if (typeof candidate !== "string") return null;
    const option =
      options.find((entry) => entry.id === candidate) ??
      options.find((entry) => entry.name === candidate);
    return option?.name ?? null;
  };
  if (Array.isArray(value)) {
    return value
      .map(label)
      .filter((name): name is string => typeof name === "string");
  }
  return label(value);
}

export interface PropertyChangeForWebhooks {
  definition: {
    id: string;
    name: string;
    type: string;
    optionsJson: string | null;
  };
  /** Undefined or null when the page had no stored value. */
  oldValueJson: string | null | undefined;
  newValueJson: string;
}

/**
 * Records one `property.changed` event per changed property for every
 * webhook watching the rows' database or the page. Call it inside the write's
 * transaction, after the values are stored.
 */
export async function enqueuePropertyChangeWebhooks(
  tx: Db,
  args: {
    databaseId: string;
    rows: Array<{ documentId: string; changes: PropertyChangeForWebhooks[] }>;
    /** Defaults to the caller of the surrounding withContentWebhookDelivery. */
    actor?: ContentChangeActor;
  },
): Promise<number> {
  const rows = args.rows
    .map((row) => ({
      documentId: row.documentId,
      changes: row.changes.filter(
        (change) => (change.oldValueJson ?? "null") !== change.newValueJson,
      ),
    }))
    .filter((row) => row.changes.length > 0);
  if (!rows.length) return 0;
  const webhooks = (
    await webhooksForDocuments(
      tx,
      rows.map((row) => row.documentId),
      [args.databaseId],
    )
  ).filter((webhook) => webhookEvents(webhook).includes("property.changed"));
  if (!webhooks.length) return 0;
  const actor = args.actor ?? currentActor();
  const now = new Date().toISOString();
  const deliveries = rows.flatMap(({ documentId, changes }) =>
    webhooks
      .filter(
        (webhook) =>
          webhook.scopeType === "database" || webhook.scopeId === documentId,
      )
      .flatMap((webhook) => {
        const propertyIds = webhookPropertyIds(webhook);
        return changes
          .filter(
            (change) =>
              !propertyIds || propertyIds.includes(change.definition.id),
          )
          .map((change) => {
            const fullOldValue = parsePropertyValue(change.oldValueJson);
            const fullNewValue = parsePropertyValue(change.newValueJson);
            const oldValue = boundedValue(fullOldValue);
            const newValue = boundedValue(fullNewValue);
            return {
              webhookId: webhook.id,
              eventType: "property.changed" as const,
              documentId,
              databaseId: args.databaseId,
              payload: {
                type: "property.changed",
                occurredAt: now,
                documentId,
                databaseId: args.databaseId,
                actor,
                data: {
                  propertyId: change.definition.id,
                  propertyName: change.definition.name,
                  propertyType: change.definition.type,
                  oldValue,
                  newValue,
                  oldLabel: optionLabel(change.definition, oldValue),
                  newLabel: optionLabel(change.definition, newValue),
                  // True when a long text value was cut; read the page for all of it.
                  truncated: overLimit(fullOldValue) || overLimit(fullNewValue),
                },
              },
            };
          });
      }),
  );
  return insertDeliveries(tx, deliveries, now);
}

/**
 * Records a `comment.created` or `comment.resolved` event for every webhook
 * watching the page or a database the page is a row of. Call it in the same
 * transaction as the comment write when there is one.
 */
export async function enqueueCommentWebhooks(
  db: Db,
  args: {
    type: "comment.created" | "comment.resolved";
    comment: {
      id: string;
      documentId: string;
      threadId: string;
      parentId: string | null;
      authorEmail: string;
      content: string;
      resolved: boolean;
    };
    /** Defaults to the caller of the surrounding withContentWebhookDelivery. */
    actor?: ContentChangeActor;
  },
): Promise<number> {
  // A page can sit in several collections at once, its space's Files among
  // them; a page-level event names the one other collection, if there is one.
  const memberships = await db
    .select({
      databaseId: schema.contentDatabaseItems.databaseId,
      filesOfSpace: schema.contentSpaces.id,
    })
    .from(schema.contentDatabaseItems)
    .innerJoin(
      schema.contentDatabases,
      eq(schema.contentDatabases.id, schema.contentDatabaseItems.databaseId),
    )
    .leftJoin(
      schema.contentSpaces,
      eq(schema.contentSpaces.filesDatabaseId, schema.contentDatabases.id),
    )
    .where(
      and(
        eq(schema.contentDatabaseItems.documentId, args.comment.documentId),
        isNull(schema.contentDatabases.deletedAt),
      ),
    );
  const databaseIds = memberships.map((membership) => membership.databaseId);
  const collections = memberships.filter(
    (membership) => !membership.filesOfSpace,
  );
  const webhooks = await webhooksForDocuments(
    db,
    [args.comment.documentId],
    databaseIds,
  );
  if (!webhooks.length) return 0;
  const actor = args.actor ?? currentActor();
  const now = new Date().toISOString();
  const rows = webhooks
    .filter((webhook) => webhookEvents(webhook).includes(args.type))
    .map((webhook) => {
      const databaseId =
        webhook.scopeType === "database"
          ? webhook.scopeId
          : collections.length === 1
            ? collections[0].databaseId
            : null;
      return {
        webhookId: webhook.id,
        eventType: args.type,
        documentId: args.comment.documentId,
        databaseId,
        payload: {
          type: args.type,
          occurredAt: now,
          documentId: args.comment.documentId,
          databaseId,
          actor,
          data: {
            commentId: args.comment.id,
            threadId: args.comment.threadId,
            parentId: args.comment.parentId,
            authorEmail: args.comment.authorEmail,
            content: args.comment.content.slice(0, MAX_COMMENT_CHARS),
            truncated: args.comment.content.length > MAX_COMMENT_CHARS,
            resolved: args.comment.resolved,
          },
        },
      };
    });
  return insertDeliveries(db, rows, now);
}

export interface ContentWebhookRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export type ContentWebhookTransportResult =
  | { ok: true; status: number }
  | { ok: false; status?: number; error: string; permanent?: boolean };

export type ContentWebhookTransport = (
  request: ContentWebhookRequest,
) => Promise<ContentWebhookTransportResult>;

/**
 * Public HTTPS only, no redirects, 10 s to answer. The connect-time address
 * check is required, not best effort: without it a name could resolve to a
 * public address for the check and a private one for the connection.
 */
export const fetchContentWebhook: ContentWebhookTransport = async (request) => {
  if (isBlockedExtensionUrl(request.url)) {
    return {
      ok: false,
      error: "The URL points to a private or internal address.",
      permanent: true,
    };
  }
  try {
    const response = await ssrfSafeFetch(
      request.url,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "Agent-Native-Content-Webhooks/1",
          ...request.headers,
        },
        body: request.body,
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
      },
      { httpsOnly: true, followRedirects: false, requireDispatcher: true },
    );
    await response.body?.cancel().catch(() => {});
    return response.ok
      ? { ok: true, status: response.status }
      : {
          ok: false,
          status: response.status,
          error: `The receiver answered ${response.status}.`,
        };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: message.slice(0, 500),
      permanent: message.startsWith("SSRF blocked"),
    };
  }
};

type DeliveryRow = typeof schema.contentWebhookDeliveries.$inferSelect;

/** The exact bytes sent, identical on every attempt. */
export function contentWebhookBody(delivery: DeliveryRow): string {
  const payload = JSON.parse(delivery.payloadJson) as Record<string, unknown>;
  return JSON.stringify({
    id: delivery.id,
    type: payload.type,
    occurredAt: payload.occurredAt,
    webhookId: delivery.webhookId,
    sequence: Number(delivery.sequence),
    documentId: payload.documentId,
    databaseId: payload.databaseId ?? null,
    actor: payload.actor,
    data: payload.data,
  });
}

/**
 * The oldest due deliveries, at most PER_WEBHOOK_BATCH of any one webhook's,
 * grouped by webhook in sequence order. Skips the webhooks in `busy`, and any
 * webhook with a delivery in flight from another drain, so each receiver gets
 * one request at a time however many drains run.
 */
async function dueDeliveriesByWebhook(
  db: Db,
  limit: number,
  busy: string[],
): Promise<Array<[webhookId: string, ids: string[]]>> {
  const deliveries = schema.contentWebhookDeliveries;
  const now = new Date().toISOString();
  const due = db
    .select({
      id: deliveries.id,
      webhookId: deliveries.webhookId,
      sequence: deliveries.sequence,
      place:
        sql<number>`row_number() over (partition by ${deliveries.webhookId} order by ${deliveries.sequence})`.as(
          "place",
        ),
    })
    .from(deliveries)
    .where(
      and(
        eq(deliveries.status, "pending"),
        lte(deliveries.nextAttemptAt, now),
        or(
          isNull(deliveries.leaseExpiresAt),
          lt(deliveries.leaseExpiresAt, now),
        ),
        busy.length ? notInArray(deliveries.webhookId, busy) : undefined,
        sql`NOT EXISTS (
          SELECT 1 FROM content_webhook_deliveries AS in_flight
          WHERE in_flight.webhook_id = ${deliveries.webhookId}
            AND in_flight.status = 'pending'
            AND in_flight.lease_expires_at >= ${now}
        )`,
      ),
    )
    .as("due");
  const rows = await db
    .select({ id: due.id, webhookId: due.webhookId })
    .from(due)
    .where(lte(due.place, PER_WEBHOOK_BATCH))
    .orderBy(asc(due.sequence))
    .limit(limit);
  const byWebhook = new Map<string, string[]>();
  for (const row of rows) {
    byWebhook.set(row.webhookId, [
      ...(byWebhook.get(row.webhookId) ?? []),
      row.id,
    ]);
  }
  return [...byWebhook.entries()];
}

/** Leases one due delivery right before sending it; null if another drain has it. */
async function claimDelivery(db: Db, id: string) {
  const deliveries = schema.contentWebhookDeliveries;
  const now = new Date().toISOString();
  const leaseToken = randomUUID();
  const [delivery] = await db
    .update(deliveries)
    .set({
      leaseToken,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS).toISOString(),
      attempts: sql`${deliveries.attempts} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(deliveries.id, id),
        eq(deliveries.status, "pending"),
        lte(deliveries.nextAttemptAt, now),
        or(
          isNull(deliveries.leaseExpiresAt),
          lt(deliveries.leaseExpiresAt, now),
        ),
      ),
    )
    .returning();
  return delivery ? { delivery, leaseToken } : null;
}

async function settleDelivery(
  db: Db,
  delivery: DeliveryRow,
  leaseToken: string,
  result: ContentWebhookTransportResult,
) {
  const deliveries = schema.contentWebhookDeliveries;
  const now = new Date();
  const exhausted = delivery.attempts >= CONTENT_WEBHOOK_MAX_ATTEMPTS;
  const status = result.ok
    ? "delivered"
    : result.permanent || exhausted
      ? "failed"
      : "pending";
  const retryDelay =
    CONTENT_WEBHOOK_RETRY_DELAYS_MS[
      Math.min(delivery.attempts, CONTENT_WEBHOOK_RETRY_DELAYS_MS.length) - 1
    ] ?? 0;
  await db
    .update(deliveries)
    .set({
      status,
      leaseToken: null,
      leaseExpiresAt: null,
      lastStatusCode: result.status ?? null,
      lastError: result.ok ? null : result.error,
      nextAttemptAt:
        status === "pending"
          ? new Date(now.getTime() + retryDelay).toISOString()
          : delivery.nextAttemptAt,
      deliveredAt: result.ok ? now.toISOString() : null,
      updatedAt: now.toISOString(),
    })
    .where(
      and(
        eq(deliveries.id, delivery.id),
        eq(deliveries.leaseToken, leaseToken),
      ),
    );
}

/**
 * Why the webhook's creator may not receive this event, or null when they may.
 * Events go out only while the creator still manages what the webhook watches,
 * and a collection's events only for rows whose page the creator can open: an
 * admin of a collection can list a row they can't open, and that row's values
 * and comments stay with the people who can, as they do in the app.
 */
async function creatorRefusal(
  webhook: WebhookRow,
  delivery: DeliveryRow,
): Promise<string | null> {
  return runWithRequestContext(
    {
      userEmail: webhook.createdBy,
      ...(webhook.orgId ? { orgId: webhook.orgId } : {}),
    },
    async () => {
      if (!(await contentWebhookScopeForRow(webhook))) {
        return "The person who added this webhook no longer manages the page or collection it watches.";
      }
      if (
        webhook.scopeType === "database" &&
        !(await resolveAccess("document", delivery.documentId, undefined, {
          skipResourceBody: true,
        }))
      ) {
        return "Not sent: the person who added this webhook can't open this row's page.";
      }
      return null;
    },
  );
}

async function deliverOne(
  db: Db,
  delivery: DeliveryRow,
  transport: ContentWebhookTransport,
): Promise<ContentWebhookTransportResult> {
  const [webhook] = await db
    .select()
    .from(schema.contentWebhooks)
    .where(eq(schema.contentWebhooks.id, delivery.webhookId))
    .limit(1);
  if (!webhook) {
    return { ok: false, error: "The webhook was removed.", permanent: true };
  }
  // Checked for every send, not once per drain, so a revoked creator's
  // events stop at the next send.
  const refusal = await creatorRefusal(webhook, delivery);
  if (refusal) return { ok: false, error: refusal, permanent: true };
  const secret = await readAppSecret(contentWebhookSecretRef(webhook));
  // A secret that can't be decrypted reads as missing, and a rotated key can
  // come back, so this retries like any other failure.
  if (!secret?.value) {
    return {
      ok: false,
      error: "The webhook's signing secret couldn't be read.",
    };
  }
  const body = contentWebhookBody(delivery);
  return transport({
    url: webhook.url,
    body,
    headers: contentWebhookHeaders({
      secret: secret.value,
      id: delivery.id,
      timestamp: Math.floor(Date.now() / 1000),
      body,
    }),
  });
}

/**
 * Sends every due delivery until none are left or the deadline passes. Safe to
 * run from several places at once: each delivery is leased before it's sent,
 * and only the lease holder settles it.
 */
export async function drainContentWebhookDeliveries(
  options: {
    deadlineAt?: number;
    signal?: AbortSignal;
    transport?: ContentWebhookTransport;
  } = {},
): Promise<{ delivered: number; failed: number; retrying: number }> {
  const db = getDb();
  const transport = options.transport ?? fetchContentWebhook;
  const deadlineAt = options.deadlineAt ?? Date.now() + 60_000;
  const counts = { delivered: 0, failed: 0, retrying: 0 };
  const expired = () => Date.now() >= deadlineAt || options.signal?.aborted;
  const sendInOrder = async (ids: string[]) => {
    let claimedAny = false;
    for (const id of ids) {
      if (expired()) break;
      const claim = await claimDelivery(db, id);
      // Another drain took it, so it's sending this webhook now; leave the
      // rest to it rather than sending alongside.
      if (!claim) break;
      claimedAny = true;
      const { delivery, leaseToken } = claim;
      const result = await deliverOne(db, delivery, transport).catch(
        (error): ContentWebhookTransportResult => ({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      await settleDelivery(db, delivery, leaseToken, result);
      if (result.ok) counts.delivered++;
      else if (
        result.permanent ||
        delivery.attempts >= CONTENT_WEBHOOK_MAX_ATTEMPTS
      )
        counts.failed++;
      else counts.retrying++;
    }
    return claimedAny;
  };
  // One worker per webhook. When a worker finishes, the loop looks for more
  // due deliveries, so a slow receiver holds up only its own events.
  const workers = new Map<string, Promise<boolean>>();
  while (!expired()) {
    const groups = await dueDeliveriesByWebhook(db, CLAIM_BATCH, [
      ...workers.keys(),
    ]);
    for (const [webhookId, ids] of groups) {
      workers.set(
        webhookId,
        sendInOrder(ids).finally(() => workers.delete(webhookId)),
      );
    }
    if (!workers.size) break;
    await Promise.race(workers.values());
  }
  await Promise.all(workers.values());
  return counts;
}

/** Drops settled deliveries once they're old enough not to matter. */
export async function purgeSettledContentWebhookDeliveries(
  options: { batchSize?: number } = {},
): Promise<void> {
  const deliveries = schema.contentWebhookDeliveries;
  const batchSize = options.batchSize ?? PURGE_BATCH;
  const now = Date.now();
  const db = getDb();
  const settled = or(
    and(
      eq(deliveries.status, "delivered"),
      lt(
        deliveries.updatedAt,
        new Date(now - DELIVERED_RETENTION_MS).toISOString(),
      ),
    ),
    and(
      eq(deliveries.status, "failed"),
      lt(
        deliveries.updatedAt,
        new Date(now - FAILED_RETENTION_MS).toISOString(),
      ),
    ),
  );
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
    const purged = await db
      .delete(deliveries)
      .where(
        inArray(
          deliveries.id,
          db
            .select({ id: deliveries.id })
            .from(deliveries)
            .where(settled)
            .limit(batchSize),
        ),
      )
      .returning({ id: deliveries.id });
    if (purged.length < batchSize) break;
  }
}

/**
 * Removes the webhooks of pages and collections that were permanently
 * deleted, with their signing secrets and their deliveries.
 * Listing and removing a webhook check the page it watches, so once that page
 * is gone nobody can reach it. Several paths delete pages and collections for
 * good, emptying the trash among them, so the sweep cleans up after all of
 * them rather than each path doing it.
 */
export async function removeOrphanedContentWebhooks(
  options: { batchSize?: number } = {},
): Promise<number> {
  // guard:allow-unscoped — a system sweep with no signed-in user; it reads only whether a webhook's page or collection still exists, and removes the webhooks of those that are gone.
  const db = getDb();
  const webhooks = schema.contentWebhooks;
  const orphaned = await db
    .select()
    .from(webhooks)
    .where(
      or(
        and(
          eq(webhooks.scopeType, "document"),
          notExists(
            db
              .select({ id: schema.documents.id })
              .from(schema.documents)
              .where(eq(schema.documents.id, webhooks.scopeId)),
          ),
        ),
        and(
          eq(webhooks.scopeType, "database"),
          notExists(
            db
              .select({ id: schema.contentDatabases.id })
              .from(schema.contentDatabases)
              .where(eq(schema.contentDatabases.id, webhooks.scopeId)),
          ),
        ),
      ),
    )
    .limit(options.batchSize ?? ORPHAN_BATCH);
  for (const webhook of orphaned) {
    // The secret first, as delete-content-webhook does: if this stops
    // halfway, the next sweep finds the webhook again and finishes.
    await deleteAppSecret(contentWebhookSecretRef(webhook));
    await db.transaction(async (tx) => {
      await tx
        .delete(schema.contentWebhookDeliveries)
        .where(eq(schema.contentWebhookDeliveries.webhookId, webhook.id));
      await tx.delete(webhooks).where(eq(webhooks.id, webhook.id));
    });
  }
  return orphaned.length;
}

export interface ContentWebhookScope {
  scopeType: ContentWebhookScopeType;
  scopeId: string;
  /** The page whose sharing decides who manages the webhook. */
  accessDocumentId: string;
  ownerEmail: string;
  orgId: string | null;
}

/**
 * The database or page a webhook watches. Managing webhooks takes admin
 * access to it, the same bar as deleting a database or migrating its rows.
 */
export async function resolveContentWebhookScope(target: {
  databaseId?: string;
  documentId?: string;
}): Promise<ContentWebhookScope> {
  if (Boolean(target.databaseId) === Boolean(target.documentId)) {
    throw new ActionContractError(
      "Pass exactly one of databaseId (every row of a collection) or documentId (one page).",
      { errorCode: "WEBHOOK_SCOPE_REQUIRED", statusCode: 400 },
    );
  }
  if (target.databaseId) {
    const database = await getDatabaseById(target.databaseId);
    if (!database) {
      throw new ActionContractError("Collection not found.", {
        errorCode: "DATABASE_NOT_FOUND",
        statusCode: 404,
      });
    }
    await assertAccess("document", database.documentId, "admin");
    return {
      scopeType: "database",
      scopeId: database.id,
      accessDocumentId: database.documentId,
      ownerEmail: database.ownerEmail,
      orgId: database.orgId ?? null,
    };
  }
  const access = await assertAccess("document", target.documentId!, "admin");
  return {
    scopeType: "document",
    scopeId: target.documentId!,
    accessDocumentId: target.documentId!,
    ownerEmail: access.resource.ownerEmail as string,
    orgId: (access.resource.orgId as string | null) ?? null,
  };
}

/** Admin access to the watched database or page; null when the caller lacks it. */
export async function contentWebhookScopeForRow(
  webhook: Pick<WebhookRow, "scopeType" | "scopeId">,
): Promise<ContentWebhookScope | null> {
  try {
    return await resolveContentWebhookScope(
      webhook.scopeType === "database"
        ? { databaseId: webhook.scopeId }
        : { documentId: webhook.scopeId },
    );
  } catch (error) {
    if (error instanceof ForbiddenError || error instanceof ActionContractError)
      return null;
    throw error;
  }
}

/** The delivery fields a webhook listing shows. */
export type RecentContentWebhookDelivery = Pick<
  DeliveryRow,
  | "id"
  | "eventType"
  | "documentId"
  | "status"
  | "attempts"
  | "lastStatusCode"
  | "lastError"
  | "nextAttemptAt"
  | "createdAt"
  | "deliveredAt"
>;

export function serializeContentWebhook(
  webhook: WebhookRow,
  recentDeliveries: RecentContentWebhookDelivery[] = [],
) {
  return {
    id: webhook.id,
    url: webhook.url,
    databaseId: webhook.scopeType === "database" ? webhook.scopeId : null,
    documentId: webhook.scopeType === "document" ? webhook.scopeId : null,
    events: webhookEvents(webhook),
    propertyIds: webhookPropertyIds(webhook),
    description: webhook.description,
    createdBy: webhook.createdBy,
    createdAt: webhook.createdAt,
    recentDeliveries: recentDeliveries.map((delivery) => ({
      id: delivery.id,
      type: delivery.eventType,
      documentId: delivery.documentId,
      status: delivery.status,
      attempts: delivery.attempts,
      lastStatusCode: delivery.lastStatusCode,
      lastError: delivery.lastError,
      nextAttemptAt:
        delivery.status === "pending" ? delivery.nextAttemptAt : null,
      createdAt: delivery.createdAt,
      deliveredAt: delivery.deliveredAt,
    })),
  };
}
