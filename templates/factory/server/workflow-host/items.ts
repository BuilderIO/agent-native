import { isDeepStrictEqual } from "node:util";

import { and, eq, inArray } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

import { triageItems } from "../db/schema.js";
import { orgFactoryItemFilter } from "../lib/factory-scope.js";
import { triageItemStatusSchema } from "../triage/contracts.js";
import { unscopedOperationItemId } from "../triage/ids.js";
import {
  mergeTriageMetadata,
  parseTriageMetadata,
} from "../triage/metadata.js";
import {
  hasTriageSourceChanged,
  statusAfterTriageSourceUpdate,
  triageSourceUpsertGuard,
} from "../triage/review-state.js";
import {
  WORKFLOW_STORE_LIMITS,
  type ItemRowState,
  type ItemWriter,
  type StoreClock,
  type WorkflowScope,
} from "../workflow/adapter.js";
import {
  WorkflowError,
  type EndOutcome,
  type WorkflowErrorCode,
} from "../workflow/contract.js";
import { END_STATUS } from "../workflow/engine/constants.js";
import {
  MAX_ROW_EXTRAS_BYTES,
  jsonByteLength,
  normalizedItemSchema,
  type NormalizedItem,
} from "../workflow/items.js";
import { serializeItemPayload, serializeTextRef } from "./item-payload.js";

export type ItemsDatabase = PgDatabase<any, any>;
export type ItemRow = typeof triageItems.$inferSelect;

/** Statuses a later poll or a second End can never move an item out of. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "dismissed",
]);

/**
 * Statuses of an item already handled, which a source must not take again:
 * done, dismissed, or handed to a person. A `released` item goes back to its
 * queue status, which is not among them.
 */
const HANDLED_STATUSES: ReadonlySet<string> = new Set([
  "resolved",
  "dismissed",
  "needs_manual",
]);

const MAX_WRITE_ATTEMPTS = 3;
const MAX_REASON_CHARS = 500;
const MAX_SUMMARY_CHARS = 4_000;
const MAX_EXTRAS_BYTES = 4 * 1024;

/**
 * The status the review queues scan for: what `list-triage-items` selects
 * with `needsReview`, and what "reopen" writes. Pull requests wait in
 * `pr_observed`; everything else waits in `received`.
 */
export function queueStatusFor(source: string): string {
  return source === "github" ? "pr_observed" : "received";
}

/**
 * Keys this host writes to `factory_items.metadata_json` for an item a
 * workflow brought in. `ITEM_KIND` and the rest let a read rebuild the
 * normalized item without guessing.
 */
export const ITEM_METADATA = {
  kind: "itemKind",
  author: "author",
  occurredAt: "occurredAt",
  extras: "extras",
  textTruncated: "textTruncated",
  payloadTruncated: "payloadTruncated",
  workflowEnd: "workflowEnd",
} as const;

type ItemWriteFailureReason =
  | "item_not_found"
  | "item_conflict"
  | "status_invalid"
  | "item_unreadable"
  | "item_invalid"
  | "output_over_cap"
  | "aborted";

interface ItemWriteFailure {
  ok: false;
  reason: ItemWriteFailureReason;
  /** The closest `WorkflowErrorCode`; `reason` is the precise cause. */
  code: WorkflowErrorCode;
  message: string;
  retryable: boolean;
  /** Set when the item exists and its status is why the write was refused. */
  currentStatus?: string;
}

type EndItemResult =
  | {
      ok: true;
      itemId: string;
      status: string;
      previousStatus: string;
      /** False when the item was already in the requested status. */
      changed: boolean;
    }
  | ItemWriteFailure;

interface EndItemRequest {
  workflowId: string;
  runId: string;
  itemId: string;
  /** What the End node decided. Optional for a plain status write. */
  outcome?: EndOutcome;
  /**
   * The status to write. Omitted, the outcome picks it (`done` resolves,
   * `released` goes back to the queue).
   */
  status?: string;
  reason?: string;
  /**
   * Values to add to the item's extras, in the write that sets the status. The
   * whole extras object stays under 8 KB; over that nothing is written.
   */
  extras?: Readonly<Record<string, unknown>>;
}

type UpsertItemsResult =
  | {
      ok: true;
      inserted: number;
      updated: number;
      unchanged: number;
      /** Rows a person or poll changed after this host read them; left as they are. */
      skipped: number;
      /** One per item given, in the order given. */
      states: { id: string; state: ItemRowState }[];
    }
  | ItemWriteFailure;

interface ItemsHostOptions {
  scope: WorkflowScope;
  /** Owner recorded on rows an upsert creates. */
  ownerEmail: string;
  /** Called on every operation, so a reset connection is never held. */
  getDatabase: () => ItemsDatabase;
  clock?: StoreClock;
}

/**
 * The `ItemWriter` the engine uses, plus the outcome-aware calls behind it.
 * `setStatus` is the engine's call (it already turned an End outcome into a
 * status); `endItem` is the same write with the outcome in hand, and the only
 * one that can release an item back to its queue.
 */
interface ItemsHost extends ItemWriter {
  endItem(request: EndItemRequest): Promise<EndItemResult>;
  /**
   * Stores items a provider source brought in as Factory inbox rows, so an End
   * node has a row to move, and says where each row stood. A re-observed item
   * keeps a `resolved`, `dismissed` or `needs_manual` status, and is reported
   * `terminal` so the source does not take it again. With `dryRun` it reads
   * the same states and writes nothing.
   */
  upsertItems(request: {
    items: readonly NormalizedItem[];
    dryRun?: boolean;
  }): Promise<UpsertItemsResult>;
}

function failure(
  reason: ItemWriteFailureReason,
  code: WorkflowErrorCode,
  message: string,
  extra: { retryable?: boolean; currentStatus?: string } = {},
): ItemWriteFailure {
  return {
    ok: false,
    reason,
    code,
    message,
    retryable: extra.retryable ?? false,
    ...(extra.currentStatus === undefined
      ? {}
      : { currentStatus: extra.currentStatus }),
  };
}

function outcomeOfStatus(status: string): EndOutcome | undefined {
  for (const [outcome, mapped] of Object.entries(END_STATUS)) {
    if (mapped === status) return outcome as EndOutcome;
  }
  return undefined;
}

/**
 * What the row's extras become with the recorded values added, and whether
 * that differs from what is stored. A row whose metadata cannot be read, or an
 * extras object that would pass the cap, is a failure, never a cut.
 */
function withRecordedExtras(
  row: ItemRow,
  recorded: Readonly<Record<string, unknown>>,
):
  | { ok: true; extras: Record<string, unknown>; changed: boolean }
  | ItemWriteFailure {
  let stored: Record<string, unknown>;
  try {
    const found = parseTriageMetadata(row.metadataJson)[ITEM_METADATA.extras];
    stored =
      typeof found === "object" && found !== null && !Array.isArray(found)
        ? (found as Record<string, unknown>)
        : {};
  } catch (error) {
    return failure(
      "item_unreadable",
      "item_invalid",
      `The stored metadata of item "${row.id}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const extras = { ...stored, ...recorded };
  const bytes = jsonByteLength(extras);
  if (bytes > MAX_ROW_EXTRAS_BYTES) {
    return failure(
      "output_over_cap",
      "output_over_cap",
      `Item "${row.id}" would hold ${bytes} bytes of extras with these values added; the cap is ${MAX_ROW_EXTRAS_BYTES}, so nothing was written.`,
    );
  }
  return { ok: true, extras, changed: !isDeepStrictEqual(extras, stored) };
}

function resolveTarget(
  request: EndItemRequest,
  row: ItemRow,
): { ok: true; status: string } | ItemWriteFailure {
  const requested =
    request.status ??
    (request.outcome === undefined ? null : END_STATUS[request.outcome]);
  if (request.outcome === "released" && request.status === undefined) {
    return { ok: true, status: queueStatusFor(row.source) };
  }
  if (requested === null) {
    return failure(
      "status_invalid",
      "graph_invalid",
      "An end needs an outcome or a status to write.",
    );
  }
  const parsed = triageItemStatusSchema.safeParse(requested);
  if (!parsed.success) {
    return failure(
      "status_invalid",
      "graph_invalid",
      `"${requested}" is not an inbox status.`,
    );
  }
  return { ok: true, status: parsed.data };
}

/**
 * Writes one item's status under the rules a poll follows. A `resolved` or
 * `dismissed` item stays that way, so the same End twice is a no-op and a
 * different End is a conflict; the write is conditional on the row still being
 * the one it read, so a poll or a person landing in between is seen, not
 * overwritten.
 */
async function endOne(
  db: ItemsDatabase,
  scope: WorkflowScope,
  request: EndItemRequest,
  now: () => string,
): Promise<EndItemResult> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt += 1) {
    const row = (
      await db
        .select()
        .from(triageItems)
        .where(
          and(
            eq(triageItems.id, request.itemId),
            orgFactoryItemFilter(scope.orgId, scope.factoryId),
          ),
        )
        .limit(1)
    )[0];
    if (!row) {
      return failure(
        "item_not_found",
        "item_invalid",
        `Item "${request.itemId}" is not in this factory's inbox.`,
      );
    }
    const target = resolveTarget(request, row);
    if (!target.ok) return target;
    const status = target.status;

    let recorded: Record<string, unknown> | undefined;
    if (request.extras !== undefined) {
      const merged = withRecordedExtras(row, request.extras);
      if (!merged.ok) return merged;
      if (merged.changed) recorded = merged.extras;
    }

    if (row.status === status && recorded === undefined) {
      return {
        ok: true,
        itemId: row.id,
        status,
        previousStatus: row.status,
        changed: false,
      };
    }
    if (row.status !== status && TERMINAL_STATUSES.has(row.status)) {
      return failure(
        "item_conflict",
        "item_conflict",
        `Item "${row.id}" is already ${row.status}; it cannot be moved to ${status}.`,
        { currentStatus: row.status },
      );
    }

    const outcome = request.outcome ?? outcomeOfStatus(status);
    const at = now();
    let metadataJson: string;
    try {
      const patch: Record<string, unknown> = {
        [ITEM_METADATA.workflowEnd]:
          request.outcome === "released"
            ? undefined
            : {
                workflowId: request.workflowId,
                runId: request.runId,
                status,
                ...(outcome === undefined ? {} : { outcome }),
                ...(request.reason === undefined
                  ? {}
                  : { reason: request.reason.slice(0, MAX_REASON_CHARS) }),
                at,
              },
      };
      // A parked pull request is reselected by this key whatever its status,
      // so leaving it would let the next poll reopen an item that just ended.
      if (row.source === "github" && TERMINAL_STATUSES.has(status)) {
        patch.prBabysitState = undefined;
      }
      if (recorded !== undefined) patch[ITEM_METADATA.extras] = recorded;
      metadataJson = mergeTriageMetadata(row.metadataJson, patch);
    } catch (error) {
      return failure(
        "item_unreadable",
        "item_invalid",
        `The stored metadata of item "${row.id}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const written = await db
      .update(triageItems)
      .set({ status, metadataJson, updatedAt: at })
      .where(
        and(
          eq(triageItems.id, row.id),
          orgFactoryItemFilter(scope.orgId, scope.factoryId),
          eq(triageItems.updatedAt, row.updatedAt),
          eq(triageItems.status, row.status),
        ),
      )
      .returning({ id: triageItems.id });
    if (written.length > 0) {
      return {
        ok: true,
        itemId: row.id,
        status,
        previousStatus: row.status,
        changed: true,
      };
    }
  }
  return failure(
    "item_conflict",
    "item_conflict",
    `Item "${request.itemId}" kept changing while it was being moved; nothing was written.`,
    { retryable: true },
  );
}

/** Thrown inside the upsert transaction to roll it back with a typed reason. */
class UpsertAborted extends Error {
  constructor(readonly failure: ItemWriteFailure) {
    super(failure.message);
  }
}

interface PreparedItem {
  item: NormalizedItem;
  metadata: Record<string, unknown>;
  summary: string | null;
  payloadJson: string;
  textRef: string | null;
}

function prepareItem(item: NormalizedItem): PreparedItem | ItemWriteFailure {
  const checked = normalizedItemSchema.safeParse(item);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return failure(
      "item_invalid",
      "item_invalid",
      `Item "${item.id}" is not a valid item: ${issue?.path.join(".") || "(root)"}: ${issue?.message}.`,
    );
  }
  const value = checked.data;
  if (!/^[a-z][a-z0-9_-]*$/.test(value.provider)) {
    return failure(
      "item_invalid",
      "item_invalid",
      `Item "${value.id}" has provider "${value.provider}", which is not a lowercase provider id.`,
    );
  }
  if (value.text !== undefined && value.text.length > MAX_SUMMARY_CHARS) {
    return failure(
      "output_over_cap",
      "output_over_cap",
      `Item "${value.id}" has ${value.text.length} characters of text; a body over ${MAX_SUMMARY_CHARS} goes to blob storage and the item keeps its handle.`,
    );
  }
  if (jsonByteLength(value.extras) > MAX_EXTRAS_BYTES) {
    return failure(
      "output_over_cap",
      "output_over_cap",
      `Item "${value.id}" has ${jsonByteLength(value.extras)} bytes of extras; the cap is ${MAX_EXTRAS_BYTES}.`,
    );
  }
  let payloadJson: string;
  let textRef: string | null = null;
  try {
    const payload =
      value.payload === undefined
        ? undefined
        : typeof value.payload === "object" &&
            value.payload !== null &&
            !Array.isArray(value.payload)
          ? (value.payload as Record<string, unknown>)
          : { value: value.payload };
    payloadJson = serializeItemPayload(payload);
    if (value.textRef !== undefined) textRef = serializeTextRef(value.textRef);
  } catch (error) {
    if (error instanceof WorkflowError) {
      return failure(
        "output_over_cap",
        error.code,
        `Item "${value.id}": ${error.message}`,
      );
    }
    return failure(
      "item_invalid",
      "item_invalid",
      `Item "${value.id}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return {
    item: value,
    metadata: {
      [ITEM_METADATA.kind]: value.kind,
      [ITEM_METADATA.occurredAt]: value.occurredAt,
      ...(value.author === undefined
        ? {}
        : { [ITEM_METADATA.author]: value.author }),
      [ITEM_METADATA.extras]: value.extras,
      ...(value.textTruncated === undefined
        ? {}
        : { [ITEM_METADATA.textTruncated]: value.textTruncated }),
      ...(value.payloadTruncated === undefined
        ? {}
        : { [ITEM_METADATA.payloadTruncated]: value.payloadTruncated }),
    },
    summary: value.text ?? null,
    payloadJson,
    textRef,
  };
}

/**
 * Where a stored row stands. A status Factory does not know cannot be told
 * from a handled one, so it fails the write instead of reading as open.
 */
function rowStateOf(
  itemId: string,
  status: string,
): ItemRowState | ItemWriteFailure {
  const known = triageItemStatusSchema.safeParse(status);
  if (!known.success) {
    return failure(
      "item_unreadable",
      "item_invalid",
      `Item "${itemId}" has the status "${status}", which Factory does not know, so it cannot be told apart from a new or a handled item.`,
    );
  }
  return HANDLED_STATUSES.has(known.data) ? "terminal" : "open";
}

async function upsertBatch(
  db: ItemsDatabase,
  scope: WorkflowScope,
  ownerEmail: string,
  items: readonly NormalizedItem[],
  now: () => string,
  dryRun: boolean,
): Promise<UpsertItemsResult> {
  if (items.length > WORKFLOW_STORE_LIMITS.itemBatchMax) {
    return failure(
      "output_over_cap",
      "output_over_cap",
      `${items.length} items in one write; the limit is ${WORKFLOW_STORE_LIMITS.itemBatchMax}.`,
    );
  }
  const prepared: PreparedItem[] = [];
  for (const item of items) {
    const result = prepareItem(item);
    if ("ok" in result) return result;
    prepared.push(result);
  }
  if (
    new Set(prepared.map((entry) => entry.item.id)).size !== prepared.length
  ) {
    return failure(
      "item_invalid",
      "item_invalid",
      "A batch of items repeats an id.",
    );
  }

  const counts = { inserted: 0, updated: 0, unchanged: 0, skipped: 0 };
  const states: { id: string; state: ItemRowState }[] = [];
  const work = async (conn: ItemsDatabase) => {
    for (const entry of prepared) {
      const { item } = entry;
      const existing = (
        await conn
          .select()
          .from(triageItems)
          .where(
            and(
              eq(triageItems.id, item.id),
              orgFactoryItemFilter(scope.orgId, scope.factoryId),
            ),
          )
          .limit(1)
      )[0];
      let existingState: ItemRowState = "created";
      if (existing) {
        const read = rowStateOf(item.id, existing.status);
        if (typeof read !== "string") throw new UpsertAborted(read);
        existingState = read;
      }
      const at = now();
      const sourceChanged = hasTriageSourceChanged(existing, {
        title: item.title,
        summary: entry.summary,
        sourceUrl: item.url ?? null,
        coverage: "complete",
        lastSeenAt: item.occurredAt,
      });
      // A handled row stays handled whatever the provider says now: an item
      // handed to a person is not reopened by an edit to the provider's copy.
      const status =
        existingState === "terminal" && existing
          ? existing.status
          : statusAfterTriageSourceUpdate(
              existing?.status,
              sourceChanged,
              "received",
            );
      if (dryRun) {
        states.push({ id: item.id, state: existingState });
        if (!existing) counts.inserted += 1;
        else if (sourceChanged) counts.updated += 1;
        else counts.unchanged += 1;
        continue;
      }
      let metadataJson: string;
      try {
        metadataJson = mergeTriageMetadata(
          existing?.metadataJson ?? "{}",
          entry.metadata,
        );
      } catch (error) {
        throw new UpsertAborted(
          failure(
            "item_unreadable",
            "item_invalid",
            `The stored metadata of item "${item.id}" cannot be read: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
      const updatedAt = sourceChanged ? at : (existing?.updatedAt ?? at);
      const returned = await conn
        .insert(triageItems)
        .values({
          id: item.id,
          source: item.provider,
          externalId: item.externalId,
          sourceUrl: item.url ?? null,
          title: item.title,
          summary: entry.summary,
          status,
          risk: "unknown",
          coverage: "complete",
          channelId: item.thread?.channelId ?? null,
          threadTs: item.thread?.threadTs ?? null,
          repository: item.thread?.repo ?? null,
          pullRequestNumber: item.thread?.number ?? null,
          dedupeKey: item.id,
          metadataJson,
          payloadJson: entry.payloadJson,
          textRef: entry.textRef,
          lastSeenAt: item.occurredAt,
          createdAt: at,
          updatedAt,
          ownerEmail,
          orgId: scope.orgId,
          factoryId: scope.factoryId,
        })
        .onConflictDoUpdate({
          target: triageItems.id,
          set: {
            sourceUrl: item.url ?? null,
            title: item.title,
            summary: entry.summary,
            status,
            channelId: item.thread?.channelId ?? null,
            threadTs: item.thread?.threadTs ?? null,
            repository: item.thread?.repo ?? null,
            pullRequestNumber: item.thread?.number ?? null,
            metadataJson,
            payloadJson: entry.payloadJson,
            textRef: entry.textRef,
            lastSeenAt: item.occurredAt,
            updatedAt,
          },
          // The id is the primary key across every org, so the update must
          // also prove the row it lands on is this factory's.
          setWhere: and(
            triageSourceUpsertGuard(existing, status, at),
            orgFactoryItemFilter(scope.orgId, scope.factoryId),
          ),
        })
        .returning({ id: triageItems.id });
      if (returned.length > 0) {
        if (!existing) counts.inserted += 1;
        else if (sourceChanged) counts.updated += 1;
        else counts.unchanged += 1;
        states.push({ id: item.id, state: existingState });
        continue;
      }
      // Someone changed the row after it was read, so what it is now decides.
      const landed = (
        await conn
          .select({ id: triageItems.id, status: triageItems.status })
          .from(triageItems)
          .where(
            and(
              eq(triageItems.id, item.id),
              orgFactoryItemFilter(scope.orgId, scope.factoryId),
            ),
          )
          .limit(1)
      )[0];
      if (!landed) {
        throw new UpsertAborted(
          failure(
            "item_conflict",
            "item_conflict",
            `Item id "${item.id}" is already used by a row outside this factory, so it was not stored.`,
          ),
        );
      }
      const landedState = rowStateOf(item.id, landed.status);
      if (typeof landedState !== "string") throw new UpsertAborted(landedState);
      counts.skipped += 1;
      states.push({ id: item.id, state: landedState });
    }
  };
  try {
    if (dryRun) await work(db);
    else await db.transaction(async (tx) => work(tx));
  } catch (error) {
    if (error instanceof UpsertAborted) return error.failure;
    throw error;
  }
  return { ok: true, ...counts, states };
}

/**
 * Items a provider operation brought in before ids carried a scope are stored
 * under `<operation>:<external id>`. One of those in this factory keeps that
 * id, so the state and receipts keyed by it still apply and a record already
 * handled is not taken again as new. Every other item keeps the scoped id it
 * was minted with.
 */
export async function keepStoredItemIds(
  db: ItemsDatabase,
  scope: WorkflowScope,
  operationId: string,
  items: readonly NormalizedItem[],
): Promise<NormalizedItem[]> {
  if (items.length === 0) return [];
  const unscoped = items.map((item) =>
    unscopedOperationItemId(operationId, item.externalId),
  );
  const stored = await db
    .select({ id: triageItems.id })
    .from(triageItems)
    .where(
      and(
        inArray(triageItems.id, unscoped),
        orgFactoryItemFilter(scope.orgId, scope.factoryId),
      ),
    );
  const held = new Set(stored.map((row) => row.id));
  return items.map((item, index) =>
    held.has(unscoped[index]) ? { ...item, id: unscoped[index] } : item,
  );
}

export function createItemsHost(options: ItemsHostOptions): ItemsHost {
  const { scope, ownerEmail, getDatabase } = options;
  const clock = options.clock ?? (() => new Date());
  const now = () => clock().toISOString();

  const endItem = (request: EndItemRequest): Promise<EndItemResult> =>
    endOne(getDatabase(), scope, request, now);

  return {
    endItem,
    async setStatus(request) {
      if (request.signal.aborted) {
        return {
          ok: false,
          code: "engine_error",
          message: "aborted: the run stopped before the status was written.",
          retryable: true,
        };
      }
      const result = await endItem({
        workflowId: request.workflowId,
        runId: request.runId,
        itemId: request.itemId,
        status: request.status,
        ...(request.reason === undefined ? {} : { reason: request.reason }),
        ...(request.extras === undefined ? {} : { extras: request.extras }),
      });
      if (result.ok) return { ok: true };
      return {
        ok: false,
        code: result.code,
        // The code already names a conflict; any other reason adds to it.
        message:
          result.reason === result.code
            ? result.message
            : `${result.reason}: ${result.message}`,
        retryable: result.retryable,
      };
    },
    upsertItems: ({ items, dryRun }) =>
      upsertBatch(
        getDatabase(),
        scope,
        ownerEmail,
        items,
        now,
        dryRun === true,
      ),
  };
}
