// Test-only: an in-memory PGlite database and access/fail fakes shared by the
// recording-context action tests. Nothing in the app imports this module.
import { createRequire } from "node:module";

import { drizzle } from "drizzle-orm/pglite";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");

export type RecordingContextTestClient = Awaited<
  ReturnType<typeof PGlite.create>
>;

export type Role = "viewer" | "editor" | "owner";

const ROLE_RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

// Mirrors recording_context_items in server/plugins/db.ts (migrations v81 to
// v84). Keep the columns, indexes, and the partial unique index predicate
// identical to it.
const CONTEXT_ITEMS_DDL = `
  CREATE TABLE recording_context_items (
    id TEXT PRIMARY KEY,
    recording_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'screen_history',
    label TEXT,
    requested_seconds INTEGER NOT NULL,
    original_started_at TEXT NOT NULL,
    original_ended_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    status TEXT NOT NULL,
    media_recording_id TEXT,
    pending_media_recording_id TEXT,
    captured_device_id TEXT,
    duration_ms INTEGER,
    width INTEGER,
    height INTEGER,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
    updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
  );
  CREATE UNIQUE INDEX recording_context_items_active_recording_unique_idx
    ON recording_context_items (recording_id) WHERE status <> 'removed';
  CREATE INDEX recording_context_items_pending_idx
    ON recording_context_items (created_at) WHERE status = 'pending';
  CREATE INDEX recording_context_items_media_recording_idx
    ON recording_context_items (media_recording_id);
  CREATE INDEX recording_context_items_pending_media_recording_idx
    ON recording_context_items (pending_media_recording_id);
`;

// Only the recordings and shares columns the actions under test read or write.
const RECORDINGS_DDL = `
  CREATE TABLE recordings (
    id TEXT PRIMARY KEY,
    owner_email TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private',
    source_app_name TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE recording_shares (
    id TEXT PRIMARY KEY,
    resource_id TEXT NOT NULL
  );
`;

export async function openRecordingContextTestDb() {
  const client: RecordingContextTestClient = await PGlite.create("memory://");
  await client.exec(RECORDINGS_DDL + CONTEXT_ITEMS_DDL);
  return { client, db: drizzle(client) };
}

// Start each test from empty tables. Opening PGlite is the slow part, so tests
// share one database per file and reset it here.
export async function resetRecordingContextTestDb(
  client: RecordingContextTestClient,
): Promise<void> {
  await client.exec(
    `TRUNCATE recording_context_items, recording_shares, recordings`,
  );
}

// The Clip's recording start. Context windows in these tests end here.
export const RECORDING_CREATED_AT = "2026-10-01T12:00:00.000Z";

export interface SeedRecordingOptions {
  id: string;
  ownerEmail?: string;
  visibility?: string;
  sourceAppName?: string | null;
  createdAt?: string;
}

export async function seedRecording(
  client: RecordingContextTestClient,
  options: SeedRecordingOptions,
): Promise<void> {
  await client.query(
    `INSERT INTO recordings (id, owner_email, visibility, source_app_name, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [
      options.id,
      options.ownerEmail ?? "owner@example.com",
      options.visibility ?? "private",
      options.sourceAppName ?? null,
      options.createdAt ?? RECORDING_CREATED_AT,
    ],
  );
}

export async function seedDirectShare(
  client: RecordingContextTestClient,
  recordingId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO recording_shares (id, resource_id) VALUES ($1, $2)`,
    [`share_${recordingId}`, recordingId],
  );
}

export interface SeedContextItemOptions {
  id: string;
  recordingId?: string;
  status?: string;
  requestedSeconds?: number;
  originalStartedAt?: string;
  originalEndedAt?: string;
  startedAt?: string;
  endedAt?: string;
  mediaRecordingId?: string | null;
  pendingMediaRecordingId?: string | null;
  capturedDeviceId?: string | null;
  createdAt?: string;
}

// Defaults describe a 30 s window that ends at a 12:00:00 recording start.
export async function seedContextItem(
  client: RecordingContextTestClient,
  options: SeedContextItemOptions,
): Promise<void> {
  const originalStartedAt =
    options.originalStartedAt ?? "2026-10-01T11:59:30.000Z";
  const originalEndedAt = options.originalEndedAt ?? "2026-10-01T12:00:00.000Z";
  await client.query(
    `INSERT INTO recording_context_items (
       id, recording_id, requested_seconds, original_started_at, original_ended_at,
       started_at, ended_at, status, media_recording_id, pending_media_recording_id,
       captured_device_id, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)`,
    [
      options.id,
      options.recordingId ?? "rec_1",
      options.requestedSeconds ?? 30,
      originalStartedAt,
      originalEndedAt,
      options.startedAt ?? originalStartedAt,
      options.endedAt ?? originalEndedAt,
      options.status ?? "pending",
      options.mediaRecordingId ?? null,
      options.pendingMediaRecordingId ?? null,
      options.capturedDeviceId ?? null,
      options.createdAt ?? "2026-10-01T12:00:01.000Z",
    ],
  );
}

export async function readContextItemRow(
  client: RecordingContextTestClient,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await client.query(
    `SELECT * FROM recording_context_items WHERE id = $1`,
    [id],
  );
  return result.rows[0] as Record<string, unknown> | undefined;
}

// Same contract as the core assertAccess: throws when the caller's role on the
// resource is missing or below the requested minimum.
export function testAssertAccess(
  roles: Record<string, Role | undefined>,
  resourceId: string,
  minRole: Role = "viewer",
): void {
  const role = roles[resourceId];
  if (!role || ROLE_RANK[role] < ROLE_RANK[minRole]) {
    throw Object.assign(new Error(`No ${minRole} access to ${resourceId}`), {
      statusCode: 403,
    });
  }
}

// Mirrors the ActionContractError fields that the action boundary reads.
export function testFail(
  message: string,
  options: { errorCode?: string; statusCode?: number } = {},
): never {
  throw Object.assign(new Error(message), {
    actionContractError: true,
    errorCode: options.errorCode ?? "action_failed",
    statusCode: options.statusCode ?? 400,
  });
}

// Pushes "update" onto `events` each time a transaction writes an item row.
// Order against the trash fake's own pushes is what the tests check. The trash
// fake cannot read the row mid-transaction: PGlite makes a query from outside
// the open transaction wait for it, so the transaction handle is the only
// place the write order is visible.
export function traceItemWrites<T extends object>(db: T, events: string[]): T {
  return new Proxy(db, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop !== "transaction") return value.bind(target);
      return (run: (tx: object) => unknown) =>
        value.call(target, (tx: object) =>
          run(traceTransactionWrites(tx, events)),
        );
    },
  });
}

function traceTransactionWrites<T extends object>(tx: T, events: string[]): T {
  return new Proxy(tx, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop !== "update") return value.bind(target);
      return (...args: unknown[]) => {
        events.push("update");
        return value.apply(target, args);
      };
    },
  });
}
