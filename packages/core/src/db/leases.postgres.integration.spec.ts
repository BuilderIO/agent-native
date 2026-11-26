import { randomUUID } from "node:crypto";

import { sql as drizzleSql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  appStateCompareAndSet,
  appStateGet,
  ensureTable as ensureAppStateTable,
} from "../application-state/store.js";
import { toPostgresParams, withDbExec, type DbExec } from "./client.js";
import { claimLease, leaseHeld, type Lease } from "./leases.js";
import { withMigrationRuntime } from "./migration-runtime.js";

const databaseUrl = process.env.AGENT_RUN_POSTGRES_TEST_URL;
const coreIntegrationJob = process.env.GITHUB_JOB === "core-integration-tests";
if (process.env.CI && coreIntegrationJob && !databaseUrl) {
  throw new Error("AGENT_RUN_POSTGRES_TEST_URL is required in CI");
}

function connect(): postgres.Sql {
  if (!databaseUrl) throw new Error("AGENT_RUN_POSTGRES_TEST_URL is not set");
  return postgres(databaseUrl, { max: 1 });
}

const START = new Date("2026-01-01T00:00:00.000Z").getTime();

function executor(sql: postgres.Sql): DbExec {
  // raw-sql-ok: runs the parameterized statements core's own helpers build.
  return {
    async execute(statement) {
      const query =
        typeof statement === "string" ? { sql: statement } : statement;
      const rows = await sql.unsafe(
        toPostgresParams(query.sql),
        query.args as never[],
      );
      return { rows, rowsAffected: rows.count };
    },
    async transaction<T>(run: (tx: DbExec) => Promise<T>): Promise<T> {
      return (await sql.begin((tx) =>
        run(executor(tx as unknown as postgres.Sql)),
      )) as T;
    },
  };
}

async function backendPid(sql: postgres.Sql): Promise<number> {
  const [{ pid }] = await sql`SELECT pg_backend_pid() AS pid`;
  return Number(pid);
}

async function blockedBy(
  observer: postgres.Sql,
  pid: number,
  holderPid: number,
): Promise<boolean> {
  const rows =
    await observer`SELECT 1 WHERE ${holderPid}::int = ANY(pg_blocking_pids(${pid}::int))`;
  return rows.length > 0;
}

async function claimDuringHoldersWrite(
  observer: postgres.Sql,
  holderPid: number,
  table: string,
  key: string,
) {
  const claimerSql = connect();
  const pid = await backendPid(claimerSql);
  const claiming = { settled: false };
  const claim = claimLease(table, key, 60_000, {
    exec: executor(claimerSql),
  }).finally(() => {
    claiming.settled = true;
  });
  let waited = false;
  while (!claiming.settled && !waited) {
    waited = await blockedBy(observer, pid, holderPid);
  }
  return {
    waited,
    claim,
    close: () => claimerSql.end(),
  };
}

function pausedHolder<T>(run: (written: () => Promise<void>) => Promise<T>) {
  let commit!: () => void;
  const committed = new Promise<void>((resolve) => {
    commit = resolve;
  });
  let written!: () => void;
  const signalled = new Promise<void>((resolve) => {
    written = resolve;
  });
  const done = run(async () => {
    written();
    await committed;
  });
  const wrote = Promise.race([
    signalled,
    done.then(() => {
      throw new Error("The holder finished before it wrote.");
    }),
  ]);
  return { done, wrote, commit };
}

// oracle-change: runs where a PostgreSQL URL is set, as in the core integration job
describe.skipIf(!databaseUrl)("leases on PostgreSQL", () => {
  let observer: postgres.Sql;
  let holderSql: postgres.Sql;
  let leases: string;
  let work: string;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(START);
    observer = connect();
    holderSql = connect();
    const suffix = randomUUID().replaceAll("-", "");
    leases = `lease_fence_leases_${suffix}`;
    work = `lease_fence_work_${suffix}`;
    await observer.unsafe(
      `CREATE TABLE ${leases} (lease_key TEXT PRIMARY KEY, holder TEXT NOT NULL, expires_at BIGINT NOT NULL)`,
    );
    await observer.unsafe(
      `CREATE TABLE ${work} (id TEXT PRIMARY KEY, done_by TEXT)`,
    );
    await observer.unsafe(`INSERT INTO ${work} (id) VALUES ('job')`);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await observer.unsafe(`DROP TABLE IF EXISTS ${leases}, ${work}`);
    await holderSql.end();
    await observer.end();
  });

  async function claimed(): Promise<Lease> {
    const lease = await claimLease(leases, "job", 1_000, {
      exec: executor(observer),
    });
    if (!lease) throw new Error("expected the lease to be free");
    return lease;
  }

  it("makes a takeover wait for a write made under the lease, so it can't slip in under it (SC-05)", async () => {
    const lease = await claimed();
    const holderPid = await backendPid(holderSql);
    const holder = pausedHolder((written) =>
      drizzle(holderSql).transaction(async (tx) => {
        const rows = await tx.execute(
          drizzleSql`UPDATE ${drizzleSql.identifier(work)} SET done_by = 'a'
            WHERE id = 'job' AND ${leaseHeld(lease)} RETURNING id`,
        );
        await written();
        return rows.length;
      }),
    );
    try {
      await holder.wrote;
      vi.setSystemTime(START + 2_000);

      const takeover = await claimDuringHoldersWrite(
        observer,
        holderPid,
        leases,
        "job",
      );
      try {
        expect(takeover.waited).toBe(true);
        holder.commit();
        expect(await holder.done).toBe(1);
        expect(await takeover.claim).not.toBeNull();
      } finally {
        holder.commit();
        await takeover.claim.catch(() => null);
        await takeover.close();
      }
    } finally {
      holder.commit();
      await holder.done.catch(() => null);
    }
    expect(
      await observer.unsafe(`SELECT done_by FROM ${work} WHERE id = 'job'`),
    ).toEqual([{ done_by: "a" }]);
  });

  it("makes a takeover wait for an application state write made under the lease", async () => {
    await withDbExec(executor(observer), () =>
      withMigrationRuntime(() => ensureAppStateTable()),
    );
    const session = `lease-fence-${randomUUID()}`;
    const lease = await claimed();
    const holderPid = await backendPid(holderSql);
    const holder = pausedHolder((written) =>
      holderSql.begin((tx) =>
        withDbExec(executor(tx as unknown as postgres.Sql), async () => {
          const changed = await appStateCompareAndSet(
            session,
            "checkpoint",
            null,
            { by: "a" },
            { lease },
          );
          await written();
          return changed;
        }),
      ),
    );
    try {
      await holder.wrote;
      vi.setSystemTime(START + 2_000);

      const takeover = await claimDuringHoldersWrite(
        observer,
        holderPid,
        leases,
        "job",
      );
      try {
        expect(takeover.waited).toBe(true);
        holder.commit();
        expect(await holder.done).toBe(true);
        expect(await takeover.claim).not.toBeNull();
        expect(
          await withDbExec(executor(observer), () =>
            appStateGet(session, "checkpoint"),
          ),
        ).toEqual({ by: "a" });
      } finally {
        holder.commit();
        await takeover.claim.catch(() => null);
        await takeover.close();
      }
    } finally {
      holder.commit();
      await holder.done.catch(() => null);
      await observer`DELETE FROM application_state WHERE session_id = ${session}`;
    }
  });
});
