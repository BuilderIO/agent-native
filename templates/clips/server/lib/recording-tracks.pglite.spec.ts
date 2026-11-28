// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { runWithRequestContext } from "@agent-native/core/server";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../db/schema.js";
import type { StoredResumableSession } from "./resumable-session.js";

vi.mock("../db/index.js", async () => {
  const { createGetDb } = await import("@agent-native/core/db");
  const tables = await import("../db/schema.js");
  return { getDb: createGetDb(tables), schema: tables };
});

const {
  discardTrackUploads,
  richDraftKey,
  trackSessionKey,
  withdrawRichDraft,
} = await import("./recording-tracks.js");
const { claimLease } = await import("./recording-leases.js");
const { isLeaseLost } = await import("@agent-native/core/db");
const { compareAndSetAppState, readAppState } =
  await import("@agent-native/core/application-state");

const OWNER = "owner@example.com";
const LEASE_MS = 2 * 60 * 1000;
const RECORDING = {
  id: "rec-1",
  ownerEmail: OWNER,
  storageMode: "own" as const,
};
const SESSION_KEY = trackSessionKey("rec-1", "screen");
const DRAFT_KEY = richDraftKey("rec-1");
const STORED_URL = "https://storage.example.com/rec-1/screen.webm";

const unfinished: StoredResumableSession = {
  providerId: "s3",
  sessionId: "upload-1",
  meta: {},
  bytesUploaded: 10,
};
const completed: StoredResumableSession = {
  ...unfinished,
  meta: { completedUrl: STORED_URL },
};

function createTable(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map(
    (column) =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`,
  );
  // raw-sql-ok: test DDL built from the Drizzle schema's own column names.
  return `CREATE TABLE "${config.name}" (${columns.join(", ")})`;
}

async function asOwner<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ userEmail: OWNER }, run);
}

async function store(key: string, value: object): Promise<void> {
  const written = await asOwner(() =>
    compareAndSetAppState(
      key,
      null,
      value as unknown as Record<string, unknown>,
    ),
  );
  expect(written).toBe(true);
}

function stored(key: string) {
  return asOwner(() => readAppState(key));
}

async function claimFinalizeLease() {
  const lease = await claimLease("rich-finalize:rec-1", LEASE_MS);
  if (!lease) throw new Error("expected a free lease");
  return lease;
}

async function takeOver(): Promise<void> {
  await getDbExec().execute(
    "UPDATE clips_backfill_leases SET holder = 'finalize' WHERE lease_key = 'rich-finalize:rec-1'",
  );
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  vi.stubEnv("AGENT_USER_EMAIL", OWNER);
  await getDbExec().execute(createTable(schema.recordingTracks));
  await stored(SESSION_KEY);
  await getDbExec().execute(
    `CREATE TABLE clips_backfill_leases (
      lease_key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
  );
}, 60_000);

beforeEach(async () => {
  await getDbExec().execute("DELETE FROM clips_backfill_leases");
  await getDbExec().execute("DELETE FROM recording_tracks");
  await getDbExec().execute("DELETE FROM application_state");
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("a track discard whose lease a finalize took over", () => {
  it("keeps the session of an upload already stored as a track", async () => {
    await getDbExec().execute({
      sql: `INSERT INTO recording_tracks
        (id, recording_id, track, owner_email, url, content_type, bytes,
         start_ms, end_ms, complete, meta_json, created_at, updated_at)
        VALUES ('track-1', 'rec-1', 'screen', $1, $2, 'video/webm', 10,
          0, 9000, true, '{}', '2026-01-01', '2026-01-01')`,
      args: [OWNER, STORED_URL],
    });
    await store(SESSION_KEY, completed);
    const lease = await claimFinalizeLease();

    await expect(
      discardTrackUploads(RECORDING, {
        lease,
        stillHeld: async () => {
          await takeOver();
          return true;
        },
      }),
    ).rejects.toSatisfy(isLeaseLost);
    expect(await stored(SESSION_KEY)).toEqual(completed);
  });

  it("leaves an unfinished upload unmarked for the finalize", async () => {
    await store(SESSION_KEY, unfinished);
    const lease = await claimFinalizeLease();

    await expect(
      discardTrackUploads(RECORDING, {
        lease,
        stillHeld: async () => {
          await takeOver();
          return true;
        },
      }),
    ).rejects.toSatisfy(isLeaseLost);
    expect(await stored(SESSION_KEY)).toEqual(unfinished);
  });
});

describe("withdrawing a recorder's draft", () => {
  it("keeps a draft saved after the one it read", async () => {
    const read = { version: 1, body: { uploadGenerationId: "gen-1" } };
    const newer = { version: 1, body: { uploadGenerationId: "gen-2" } };
    await store(DRAFT_KEY, read);
    const lease = await claimFinalizeLease();
    await asOwner(() => compareAndSetAppState(DRAFT_KEY, read, newer));

    await asOwner(() => withdrawRichDraft("rec-1", read, lease));
    expect(await stored(DRAFT_KEY)).toEqual(newer);
  });

  it("refuses once a finalize took the lease over", async () => {
    const read = { version: 1, body: { uploadGenerationId: "gen-1" } };
    await store(DRAFT_KEY, read);
    const lease = await claimFinalizeLease();
    await takeOver();

    await expect(
      asOwner(() => withdrawRichDraft("rec-1", read, lease)),
    ).rejects.toSatisfy(isLeaseLost);
    expect(await stored(DRAFT_KEY)).toEqual(read);
  });

  it("withdraws the draft it read while it holds the lease", async () => {
    const read = { version: 1, body: { uploadGenerationId: "gen-1" } };
    await store(DRAFT_KEY, read);
    const lease = await claimFinalizeLease();

    await asOwner(() => withdrawRichDraft("rec-1", read, lease));
    expect(await stored(DRAFT_KEY)).toBeNull();
  });
});
