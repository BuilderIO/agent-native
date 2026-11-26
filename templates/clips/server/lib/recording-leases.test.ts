import { closeDbExec, getDbExec } from "@agent-native/core/db";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  claimLease,
  countAttempt,
  isLeaseHeld,
  releaseLease,
  renewLease,
} from "./recording-leases.js";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  await getDbExec().execute(`
    CREATE TABLE clips_backfill_leases (
      lease_key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL,
      cursor_id TEXT,
      completed_at TEXT
    )
  `);
  await getDbExec().execute(
    "CREATE TABLE application_state (key TEXT PRIMARY KEY, value TEXT)",
  );
}, 60_000);

beforeEach(async () => {
  await getDbExec().execute(`DELETE FROM clips_backfill_leases`);
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

const rows = async () =>
  (await getDbExec().execute("SELECT * FROM clips_backfill_leases"))
    .rows as Array<{
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
    expect(lease.table).toBe("clips_backfill_leases");
    expect(await rows()).toHaveLength(1);
    await releaseLease(lease);
    await countAttempt("thumbnail-sweeper-attempts:a");

    expect(
      (await getDbExec().execute("SELECT * FROM application_state")).rows,
    ).toEqual([]);
    expect((await rows()).map((row) => row.lease_key)).toEqual([
      "thumbnail-sweeper-attempts:a",
    ]);
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

  describe("isLeaseHeld", () => {
    it("is true only while a live lease exists", async () => {
      expect(await isLeaseHeld("k")).toBe(false);

      const lease = await claimLease("k", 60_000);
      if (!lease) throw new Error("expected the lease to be free");
      expect(await isLeaseHeld("k")).toBe(true);

      await releaseLease(lease);
      expect(await isLeaseHeld("k")).toBe(false);
    });

    it("treats an expired lease as not held", async () => {
      await claimLease("k", -1);

      expect(await isLeaseHeld("k")).toBe(false);
    });
  });

  describe("renewLease", () => {
    it("extends a lease we still hold", async () => {
      const lease = await claimLease("k", 1_000);
      if (!lease) throw new Error("expected the lease to be free");
      const before = Number((await rows())[0]?.expires_at);

      expect(await renewLease(lease, 60_000)).toBe(true);

      expect(Number((await rows())[0]?.expires_at)).toBeGreaterThan(before);
    });

    it("does not touch a lease that expired and was retaken", async () => {
      const stale = await claimLease("k", -1);
      if (!stale) throw new Error("expected the lease to be free");
      const taken = await claimLease("k", 60_000);
      if (!taken) throw new Error("expected the expired lease to be free");

      expect(await renewLease(stale, 60_000)).toBe(false);
      expect((await rows())[0]?.holder).toBe(taken.token);
    });
  });
});
