// guard:allow-unscoped — isolated PostgreSQL-compatible fixtures.
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import * as schema from "../db/schema.js";

vi.mock("../db/index.js", async () => {
  const { createGetDb } = await import("@agent-native/core/db");
  const tables = await import("../db/schema.js");
  return { getDb: createGetDb(tables), schema: tables };
});
vi.mock("@agent-native/core/server", async (original) => ({
  ...(await original<typeof import("@agent-native/core/server")>()),
  getAppConfig: () => ({
    clips: {
      hostedStorage: {
        perIdentityClipLimit: 3,
        maxClipBytes: 100,
        retainedByteAlertRatio: 0.8,
      },
    },
  }),
}));
vi.mock("./hosted-clip-tracking.js", () => ({
  trackHostedClipEvent: vi.fn(),
}));

const { addHostedClipRetainedBytesWithinCap } =
  await import("./hosted-clip-allowance.js");
const { claimLease } = await import("./recording-leases.js");
const { isLeaseLost } = await import("@agent-native/core/db");
const { compareAndSetAppState, readAppState } =
  await import("@agent-native/core/application-state");

const OWNER = "owner@example.com";
const MARK_KEY = "resumable-session-rec-1-track-screen";
const LEASE_MS = 2 * 60 * 1000;
const START = new Date("2026-01-01T00:00:00.000Z").getTime();

function createTable(table: PgTable): string {
  const config = getTableConfig(table);
  const columns = config.columns.map(
    (column) =>
      `"${column.name}" ${column.getSQLType()}${column.primary ? " PRIMARY KEY" : ""}`,
  );
  // raw-sql-ok: test DDL built from the Drizzle schema's own column names.
  return `CREATE TABLE "${config.name}" (${columns.join(", ")})`;
}

async function retainedBytes(): Promise<number> {
  const result = await getDbExec().execute(
    "SELECT quota_bytes FROM clips_hosted_clip_allowances WHERE recording_id = 'rec-1'",
  );
  return Number(result.rows[0]?.quota_bytes);
}

function charge(whileCharging: () => Promise<void>) {
  return addHostedClipRetainedBytesWithinCap({
    recordingId: "rec-1",
    userId: "user-1",
    additionalBytes: 5,
    whileCharging,
  });
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  vi.stubEnv("AGENT_USER_EMAIL", OWNER);
  await getDbExec().execute(createTable(schema.hostedClipAllowances));
  await readAppState(MARK_KEY);
  await getDbExec().execute(
    `CREATE TABLE clips_backfill_leases (
      lease_key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
  );
}, 60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  await getDbExec().execute("DELETE FROM clips_backfill_leases");
  await getDbExec().execute("DELETE FROM clips_hosted_clip_allowances");
  await getDbExec().execute("DELETE FROM application_state");
  await getDbExec().execute(
    `INSERT INTO clips_hosted_clip_allowances
      (recording_id, identity_key, user_id, status, quota_bytes, created_at, updated_at)
      VALUES ('rec-1', 'user:user-1', 'user-1', 'consumed', 10, '2026-01-01', '2026-01-01')`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("a hosted byte charge and the mark written while it runs", () => {
  it("commit together", async () => {
    const result = await charge(async () => {
      expect(
        await compareAndSetAppState(MARK_KEY, null, { counted: true }),
      ).toBe(true);
    });

    expect(result).toMatchObject({ ok: true });
    expect(await retainedBytes()).toBe(15);
    expect(await readAppState(MARK_KEY)).toEqual({ counted: true });
  });

  it("roll back together when the step inside the charge fails", async () => {
    await expect(
      charge(async () => {
        await compareAndSetAppState(MARK_KEY, null, { counted: true });
        throw new Error("The track's upload changed.");
      }),
    ).rejects.toThrow("The track's upload changed.");

    expect(await retainedBytes()).toBe(10);
    expect(await readAppState(MARK_KEY)).toBeNull();
  });

  it("charge nothing when the finalize's lease lapsed before the mark", async () => {
    const lease = await claimLease("rich-finalize:rec-1", LEASE_MS);
    if (!lease) throw new Error("expected a free lease");
    vi.setSystemTime(START + LEASE_MS + 1_000);
    await claimLease("rich-finalize:rec-1", LEASE_MS);

    const charged = charge(async () => {
      await compareAndSetAppState(MARK_KEY, null, { counted: true }, { lease });
    });

    await expect(charged).rejects.toSatisfy(isLeaseLost);
    expect(await retainedBytes()).toBe(10);
    expect(await readAppState(MARK_KEY)).toBeNull();
  });
});
