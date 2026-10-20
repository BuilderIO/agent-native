import { and, eq, type SQL } from "drizzle-orm";
import type { AnyPgColumn, PgDatabase } from "drizzle-orm/pg-core";
import { z } from "zod";

import type {
  factoryWorkflowItemEvents,
  factoryWorkflowReceipts,
  factoryWorkflowRuns,
  factoryWorkflowSteps,
} from "../../db/schema.js";
import type { WorkflowScope } from "../../workflow/adapter.js";

// Any Drizzle PostgreSQL database: the app's `getDb()` or a PGlite instance in
// a spec.
export type ReadDatabase = PgDatabase<any, any>;

export type RunRow = typeof factoryWorkflowRuns.$inferSelect;
export type StepRow = typeof factoryWorkflowSteps.$inferSelect;
export type EventRow = typeof factoryWorkflowItemEvents.$inferSelect;
export type ReceiptRow = typeof factoryWorkflowReceipts.$inferSelect;

/**
 * Every bound on what a read returns. A list that hits one says so
 * (`hasMore`, or a `...Truncated` flag); nothing is cut without a flag.
 */
export const READ_LIMITS = {
  pageDefault: 25,
  pageMax: 100,
  /** An opaque cursor is at most this many characters. */
  cursorChars: 16 * 1024,
  journeyEventsDefault: 100,
  journeyEventsMax: 300,
  /** One event summary is stored at up to 2 KB; a read never clips below that. */
  eventSummaryChars: 2048,
  /** Item ids and receipt keys a run detail lists per port or per step. */
  runListPerStep: 25,
  /** A step's field map is returned whole up to this size, else flagged. */
  runStepFieldsBytes: 2048,
  /** Items shown as a sample per port in a node audit. */
  sampleItemsPerPort: 5,
  /** A short summary beside a sampled item or an error. */
  shortSummaryChars: 300,
  nodeAuditDefault: 20,
  nodeAuditMax: 50,
  nodeAuditReceipts: 50,
  nodeAuditItemErrors: 10,
  journeyReceipts: 50,
  searchChars: 100,
} as const;

export const WORKFLOW_READ_ERROR_CODES = [
  "workflow_not_found",
  "run_not_found",
  "item_not_found",
  "node_not_found",
  "bad_cursor",
  "invalid_input",
] as const;
export type WorkflowReadErrorCode = (typeof WORKFLOW_READ_ERROR_CODES)[number];

/**
 * A read that cannot answer because of what the caller asked: something that
 * is not there, or a cursor that is not ours. A stored value that no longer
 * parses is a different failure, `WorkflowStoreError("corrupt_record")`, and
 * the two never share a result with an empty list.
 */
export class WorkflowReadError extends Error {
  readonly code: WorkflowReadErrorCode;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: WorkflowReadErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkflowReadError";
    this.code = code;
    this.details = details;
  }
}

export interface ReadPage<T> {
  items: T[];
  hasMore: boolean;
  /** Pass it back to get the next page; null when this one is the last. */
  nextCursor: string | null;
}

// Cursors

type CursorKind = "runs" | "items" | "parked" | "events" | "activity";

export function encodeCursor(
  kind: CursorKind,
  value: Record<string, unknown>,
): string {
  return Buffer.from(JSON.stringify({ k: kind, ...value })).toString(
    "base64url",
  );
}

function badCursor(kind: CursorKind): WorkflowReadError {
  return new WorkflowReadError(
    "bad_cursor",
    `That cursor is not a ${kind} cursor, or it is damaged. Start again without one.`,
    { kind },
  );
}

export function decodeCursor<S extends z.ZodType>(
  kind: CursorKind,
  raw: string,
  schema: S,
): z.output<S> {
  if (raw.length > READ_LIMITS.cursorChars) throw badCursor(kind);
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    // coercion-ok: undecodable text is reported as a bad cursor just below
    throw badCursor(kind);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success || (value as { k?: unknown } | null)?.k !== kind) {
    throw badCursor(kind);
  }
  return parsed.data;
}

const instantSchema = z.iso.datetime({ offset: true });
const idTextSchema = z.string().min(1).max(600);

export const runsCursorSchema = z.looseObject({
  at: instantSchema,
  id: idTextSchema,
});
export const itemsCursorSchema = z.looseObject({
  at: instantSchema,
  wf: idTextSchema,
  id: idTextSchema,
});
export const parkedCursorSchema = z.looseObject({
  due: instantSchema,
  id: idTextSchema,
});
export const eventsCursorSchema = z.looseObject({
  at: instantSchema,
  id: idTextSchema,
});

/**
 * Where an Activity page stopped: the instant of its last entry, and the ids
 * already returned at exactly that instant. The next page starts from there,
 * so entries that share a millisecond are neither repeated nor skipped, and
 * the order of ties inside a source does not matter.
 */
export interface ActivityPosition {
  atMs: number;
  seen: string[];
}

const activityCursorSchema = z.looseObject({
  t: z.number().int().min(0),
  seen: z.array(idTextSchema).max(READ_LIMITS.pageMax * 2),
});

export function encodeActivityCursor(position: ActivityPosition): string {
  return encodeCursor("activity", { t: position.atMs, seen: position.seen });
}

export function decodeActivityCursor(raw: string): ActivityPosition {
  const value = decodeCursor("activity", raw, activityCursorSchema);
  return { atMs: value.t, seen: value.seen };
}

export function pageLimit(limit: number | undefined, label: string): number {
  if (limit === undefined) return READ_LIMITS.pageDefault;
  if (!Number.isInteger(limit) || limit < 1 || limit > READ_LIMITS.pageMax) {
    throw new WorkflowReadError(
      "invalid_input",
      `${label} limit must be a whole number from 1 to ${READ_LIMITS.pageMax}.`,
      { limit },
    );
  }
  return limit;
}

// Small pure rules, exported so the specs and the Activity feed share them.

export function durationMs(
  startedAt: string,
  finishedAt: string | null | undefined,
): number | null {
  if (!finishedAt) return null;
  const ms = Date.parse(finishedAt) - Date.parse(startedAt);
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

/** Nearest-rank percentile of a list of numbers; null for an empty list. */
export function percentile(
  values: readonly number[],
  fraction: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index] ?? null;
}

export function clipText(
  text: string,
  max: number,
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return { text: cut, truncated: true };
}

/** `workflow:item:node:attempt[:salt]`, each part URI-encoded (see `receiptKey`). */
export function decodeReceiptKey(key: string): {
  workflowId: string;
  itemId: string;
  nodeId: string;
  attempt: number;
} | null {
  const parts = key.split(":");
  if (parts.length !== 4 && parts.length !== 5) return null;
  try {
    const [workflowId, itemId, nodeId, attempt] = parts.map(decodeURIComponent);
    const count = Number(attempt);
    if (
      workflowId === undefined ||
      itemId === undefined ||
      nodeId === undefined ||
      !Number.isInteger(count) ||
      count < 0
    ) {
      return null;
    }
    return { workflowId, itemId, nodeId, attempt: count };
  } catch {
    // coercion-ok: a malformed escape means this is not one of our keys; callers throw
    return null;
  }
}

export function scopeOf(
  table: { orgId: AnyPgColumn; factoryId: AnyPgColumn },
  scope: WorkflowScope,
): SQL {
  return and(
    eq(table.orgId, scope.orgId),
    eq(table.factoryId, scope.factoryId),
  ) as SQL;
}

export function takeWindow<T>(
  rows: T[],
  limit: number,
): { rows: T[]; more: boolean } {
  return { rows: rows.slice(0, limit), more: rows.length > limit };
}

export function httpUrl(value: string | null): string | null {
  if (!value || !URL.canParse(value)) return null;
  const { protocol } = new URL(value);
  return protocol === "http:" || protocol === "https:" ? value : null;
}
