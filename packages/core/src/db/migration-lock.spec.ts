import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared with vi.hoisted so vi.mock's hoisting can reference them.
// ---------------------------------------------------------------------------

const state = vi.hoisted(() => ({
  lockShouldFail: false,
  unlockResult: true,
  order: [] as string[],
}));

function rowsFor(sql: string): Array<Record<string, unknown>> {
  if (/pg_advisory_unlock/i.test(sql)) {
    state.order.push("unlock");
    return [{ unlocked: state.unlockResult }];
  }
  if (/pg_advisory_lock\(/i.test(sql)) {
    state.order.push("lock");
    if (state.lockShouldFail) throw new Error("simulated lock failure");
    return [];
  }
  return [];
}

const postgresFactory = vi.hoisted(() => vi.fn());
vi.mock("postgres", () => ({
  default: (...args: unknown[]) => postgresFactory(...args),
}));

const neonClientCtor = vi.hoisted(() => vi.fn());
const neonConnect = vi.hoisted(() => vi.fn(async () => {}));
const neonQuery = vi.hoisted(() => vi.fn());
const neonEnd = vi.hoisted(() =>
  vi.fn(async () => {
    state.order.push("close");
  }),
);
vi.mock("@neondatabase/serverless", () => {
  class Client {
    constructor(config: unknown) {
      neonClientCtor(config);
    }
    connect() {
      return neonConnect();
    }
    query(sql: string) {
      return neonQuery(sql);
    }
    end() {
      return neonEnd();
    }
  }
  return { Client };
});

import { withMigrationAdvisoryLock } from "./migration-lock.js";

const POSTGRES_URL = "postgres://user:pass@localhost:5432/app";
const NEON_URL = "postgres://user:pass@ep-fake.us-east-2.aws.neon.tech/app";

beforeEach(() => {
  state.lockShouldFail = false;
  state.unlockResult = true;
  state.order = [];
  postgresFactory.mockReset();
  postgresFactory.mockImplementation(() => ({
    unsafe: vi.fn(async (sql: string) => rowsFor(sql)),
    end: vi.fn(async () => {
      state.order.push("close");
    }),
  }));
  neonClientCtor.mockClear();
  neonConnect.mockClear();
  neonQuery.mockReset();
  neonQuery.mockImplementation(async (sql: string) => ({ rows: rowsFor(sql) }));
  neonEnd.mockClear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("withMigrationAdvisoryLock", () => {
  it("acquires the lock, runs, unlocks, and closes the connection in order", async () => {
    const result = await withMigrationAdvisoryLock(POSTGRES_URL, async () => {
      state.order.push("run");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(postgresFactory).toHaveBeenCalledTimes(1);
    expect(state.order).toEqual(["lock", "run", "unlock", "close"]);
  });

  it("releases the lock and propagates the original error when run throws", async () => {
    const boom = new Error("boom");

    await expect(
      withMigrationAdvisoryLock(POSTGRES_URL, async () => {
        state.order.push("run");
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(state.order).toEqual(["lock", "run", "unlock", "close"]);
  });

  it("rejects and never calls run when the lock cannot be acquired", async () => {
    state.lockShouldFail = true;
    const run = vi.fn(async () => "should not run");

    await expect(withMigrationAdvisoryLock(POSTGRES_URL, run)).rejects.toThrow(
      /Failed to acquire the cross-process migration lock/,
    );

    expect(run).not.toHaveBeenCalled();
    // The failed connection is still closed, never left dangling.
    const created = postgresFactory.mock.results[0]?.value;
    expect(created?.end).toHaveBeenCalledTimes(1);
  });

  it("throws when pg_advisory_unlock reports the lock was not held", async () => {
    state.unlockResult = false;

    await expect(
      withMigrationAdvisoryLock(POSTGRES_URL, async () => "ok"),
    ).rejects.toThrow(/pg_advisory_unlock reported/);

    // Still closed even though the unlock was rejected as unsafe.
    expect(state.order).toContain("close");
  });

  it("shares one dedicated connection across concurrent in-process holders", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withMigrationAdvisoryLock(POSTGRES_URL, async () => {
      await firstGate;
      return "first";
    });
    // Let the first caller open the connection and take the lock before the
    // second caller starts.
    await vi.waitFor(() => expect(postgresFactory).toHaveBeenCalledTimes(1));

    const second = withMigrationAdvisoryLock(
      POSTGRES_URL,
      async () => "second",
    );
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second",
    ]);
    expect(postgresFactory).toHaveBeenCalledTimes(1);
  });

  it("does not open a connection for a non-Postgres URL", async () => {
    const result = await withMigrationAdvisoryLock(
      "pglite:./data/pglite",
      async () => "ok",
    );

    expect(result).toBe("ok");
    expect(postgresFactory).not.toHaveBeenCalled();
    expect(neonClientCtor).not.toHaveBeenCalled();
  });

  it("uses the Neon serverless client for a Neon URL", async () => {
    const result = await withMigrationAdvisoryLock(NEON_URL, async () => "ok");

    expect(result).toBe("ok");
    expect(neonClientCtor).toHaveBeenCalledTimes(1);
    expect(neonConnect).toHaveBeenCalledTimes(1);
    expect(neonEnd).toHaveBeenCalledTimes(1);
    expect(postgresFactory).not.toHaveBeenCalled();
    expect(state.order).toEqual(["lock", "unlock", "close"]);
  });
});
