import { and, eq } from "drizzle-orm";
import { pgTable, text } from "drizzle-orm/pg-core";
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

import { closeDbExec, getDbExec } from "./client.js";
import { createGetDb } from "./create-get-db.js";
import {
  claimLease,
  holdsLease,
  isLeaseHeld,
  isLeaseLost,
  LeaseLostError,
  releaseLease,
  renewLease,
  writeUnderLease,
  type Lease,
} from "./leases.js";

const TABLE = "lease_probe_leases";
const work = pgTable("lease_probe_work", {
  id: text("id").primaryKey(),
  doneBy: text("done_by"),
});
const getDb = createGetDb({ work });
const START = new Date("2026-01-01T00:00:00.000Z").getTime();

function claimed(lease: Lease | null): Lease {
  if (!lease) throw new Error("expected the lease to be free");
  return lease;
}

function finishWork(lease: Lease, worker: string, id = "job") {
  return writeUnderLease(lease, (held) =>
    getDb()
      .update(work)
      .set({ doneBy: worker })
      .where(and(eq(work.id, id), held))
      .returning({ id: work.id }),
  );
}

async function doneBy(): Promise<string | null> {
  const rows = await getDb().select().from(work).where(eq(work.id, "job"));
  return rows.length === 1 ? (rows[0]?.doneBy ?? null) : null;
}

async function holders(): Promise<string[]> {
  const { rows } = await getDbExec().execute(
    "SELECT holder FROM lease_probe_leases",
  );
  return rows.map((row) => String(row.holder));
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "pglite:memory");
  await getDbExec().execute(
    `CREATE TABLE lease_probe_leases (
      lease_key TEXT PRIMARY KEY,
      holder TEXT NOT NULL,
      expires_at BIGINT NOT NULL
    )`,
  );
  await getDbExec().execute(
    "CREATE TABLE lease_probe_work (id TEXT PRIMARY KEY, done_by TEXT)",
  );
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START);
  await getDbExec().execute("DELETE FROM lease_probe_leases");
  await getDbExec().execute("DELETE FROM lease_probe_work");
  await getDbExec().execute(
    "INSERT INTO lease_probe_work (id, done_by) VALUES ('job', NULL)",
  );
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await closeDbExec();
  vi.unstubAllEnvs();
});

describe("claiming", () => {
  it("grants one holder at a time, per key", async () => {
    const first = await claimLease(TABLE, "job", 60_000);
    const second = await claimLease(TABLE, "job", 60_000);
    const other = await claimLease(TABLE, "other", 60_000);

    expect(first).toMatchObject({ table: TABLE, key: "job" });
    expect(second).toBeNull();
    expect(other).not.toBeNull();
  });

  it("lets an expired lease be retaken with a new token", async () => {
    const first = claimed(await claimLease(TABLE, "job", 1_000));
    vi.setSystemTime(START + 1_000);

    const retaken = claimed(await claimLease(TABLE, "job", 60_000));

    expect(retaken.token).not.toBe(first.token);
    expect(await holders()).toEqual([retaken.token]);
  });

  it("releases only its own claim", async () => {
    const stale = claimed(await claimLease(TABLE, "job", 1_000));
    vi.setSystemTime(START + 2_000);
    const current = claimed(await claimLease(TABLE, "job", 60_000));

    await releaseLease(stale);
    expect(await holders()).toEqual([current.token]);

    await releaseLease(current);
    expect(await holders()).toEqual([]);
  });

  it("renews a live lease and refuses once it has run out", async () => {
    const lease = claimed(await claimLease(TABLE, "job", 1_000));
    vi.setSystemTime(START + 500);
    expect(await renewLease(lease, 1_000)).toBe(true);

    vi.setSystemTime(START + 1_400);
    expect(await holdsLease(lease)).toBe(true);

    vi.setSystemTime(START + 1_500);
    expect(await renewLease(lease, 1_000)).toBe(false);
    expect(await holdsLease(lease)).toBe(false);
  });

  it("reports a lease as held only while it is live", async () => {
    expect(await isLeaseHeld(TABLE, "job")).toBe(false);
    await claimLease(TABLE, "job", 1_000);
    expect(await isLeaseHeld(TABLE, "job")).toBe(true);
    vi.setSystemTime(START + 1_000);
    expect(await isLeaseHeld(TABLE, "job")).toBe(false);
  });
});

describe("writes under a lease", () => {
  it("refuses the write of a holder whose lease expired and was taken over (SC-05)", async () => {
    const a = claimed(await claimLease(TABLE, "job", 1_000));
    vi.setSystemTime(START + 2_000);
    const b = claimed(await claimLease(TABLE, "job", 60_000));

    expect(await finishWork(b, "b")).toEqual([{ id: "job" }]);
    const refused = await finishWork(a, "a").catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(LeaseLostError);
    expect(isLeaseLost(refused)).toBe(true);
    expect(await doneBy()).toBe("b");
  });

  it("refuses the write of a holder whose lease ran out though nobody took it", async () => {
    const a = claimed(await claimLease(TABLE, "job", 1_000));
    vi.setSystemTime(START + 1_000);

    await expect(finishWork(a, "a")).rejects.toBeInstanceOf(LeaseLostError);
    expect(await doneBy()).toBeNull();
  });

  it("applies the write of the live holder", async () => {
    const a = claimed(await claimLease(TABLE, "job", 60_000));

    expect(await finishWork(a, "a")).toEqual([{ id: "job" }]);
    expect(await doneBy()).toBe("a");
  });

  it("tells a write that matched no row apart from a lost lease", async () => {
    const a = claimed(await claimLease(TABLE, "job", 60_000));

    expect(await finishWork(a, "a", "missing")).toEqual([]);
    expect(await doneBy()).toBeNull();
  });

  it("checks the lease inside a transaction that also locks the work row", async () => {
    const a = claimed(await claimLease(TABLE, "job", 60_000));

    const rows = await getDb().transaction(async (tx) =>
      writeUnderLease(a, (held) =>
        tx
          .select({ id: work.id })
          .from(work)
          .where(and(eq(work.id, "job"), held))
          .for("update"),
      ),
    );

    expect(rows).toEqual([{ id: "job" }]);
  });
});

describe("isLeaseLost", () => {
  it("recognizes the error by its code, from another copy of the module", () => {
    const copied = Object.assign(new Error("lost"), { code: "lease_lost" });

    expect(isLeaseLost(copied)).toBe(true);
    expect(isLeaseLost(new Error("lost"))).toBe(false);
    expect(isLeaseLost({ code: "lease_lost" })).toBe(false);
  });
});
