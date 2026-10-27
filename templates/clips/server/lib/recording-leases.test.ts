import { createRequire } from "node:module";

const { PGlite } = createRequire(
  new URL("../../../../packages/core/package.json", import.meta.url),
)("@electric-sql/pglite");
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

type PGliteClient = Awaited<ReturnType<typeof PGlite.create>>;
let client: PGliteClient;
const statements: string[] = [];

vi.mock("@agent-native/core/db", () => ({
  getDbExec: () => ({
    execute: async ({ sql, args = [] }: { sql: string; args?: unknown[] }) => {
      statements.push(sql);
      const result = await client.query(sql, args);
      return { ...result, rowsAffected: result.affectedRows };
    },
  }),
}));

import { claimLease, countAttempt, releaseLease } from "./recording-leases.js";

beforeAll(async () => {
  client = await PGlite.create("memory://");
  await client.exec(`
    CREATE TABLE clips_backfill_leases (
      lease_key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      cursor_id TEXT,
      completed_at TEXT
    )
  `);
}, 60_000);

beforeEach(async () => {
  statements.length = 0;
  await client.exec(`DELETE FROM clips_backfill_leases`);
});

afterAll(async () => {
  await client.close();
});

const rows = async () =>
  (await client.query(`SELECT * FROM clips_backfill_leases`)).rows as Array<{
    lease_key: string;
    holder: string;
    expires_at: number | string | bigint;
  }>;

describe("recording leases", () => {
  it("grants one holder at a time", async () => {
    const first = await claimLease("recording-thumbnail:a", 60_000);
    const second = await claimLease("recording-thumbnail:a", 60_000);
    const other = await claimLease("recording-thumbnail:b", 60_000);

    expect(first).toMatchObject({ key: "recording-thumbnail:a" });
    expect(second).toBeNull();
    expect(other).not.toBeNull();
  });

  it("lets the lease be retaken once it expires", async () => {
    const first = await claimLease("recording-thumbnail:a", 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    const retaken = await claimLease("recording-thumbnail:a", 60_000);

    expect(first).not.toBeNull();
    expect(retaken).not.toBeNull();
    expect(retaken!.token).not.toBe(first!.token);
    expect(await rows()).toHaveLength(1);
  });

  it("frees the lease on release and removes the row", async () => {
    const lease = (await claimLease("recording-thumbnail:a", 60_000))!;

    await releaseLease(lease);

    expect(await rows()).toEqual([]);
    expect(await claimLease("recording-thumbnail:a", 60_000)).not.toBeNull();
  });

  it("does not release a lease that expired and was taken by someone else", async () => {
    const stale = (await claimLease("recording-thumbnail:a", 1))!;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const current = (await claimLease("recording-thumbnail:a", 60_000))!;

    await releaseLease(stale);

    const remaining = await rows();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.holder).toBe(current.token);
  });

  it("stores leases only in the lease table, so claims publish no sync events", async () => {
    const lease = (await claimLease("recording-thumbnail:a", 60_000))!;
    await releaseLease(lease);
    await countAttempt("thumbnail-sweeper-attempts:a");

    expect(statements.length).toBeGreaterThan(0);
    for (const sql of statements) {
      expect(sql).toContain("clips_backfill_leases");
      expect(sql).not.toContain("application_state");
    }
  });

  it("counts attempts durably and atomically", async () => {
    const counts = await Promise.all([
      countAttempt("thumbnail-sweeper-attempts:a"),
      countAttempt("thumbnail-sweeper-attempts:a"),
      countAttempt("thumbnail-sweeper-attempts:a"),
    ]);

    expect(counts.sort()).toEqual([1, 2, 3]);
    expect(await countAttempt("thumbnail-sweeper-attempts:a")).toBe(4);
    expect(await countAttempt("thumbnail-sweeper-attempts:b")).toBe(1);
  });
});
