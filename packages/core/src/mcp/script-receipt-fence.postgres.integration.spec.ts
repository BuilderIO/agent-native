import { randomUUID } from "node:crypto";

import postgres from "postgres";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { z } from "zod";

import type {
  McpScriptFenceResult,
  McpScriptReceiptLocator,
  McpScriptReconcileResult,
} from "../action.js";
import type { ActionEntry } from "../agent/production-agent.js";
import { toPostgresParams, withDbExec, type DbExec } from "../db/client.js";
import { withMigrationRuntime } from "../db/migration-runtime.js";
import {
  ensureScriptLedgerTables,
  insertPendingScriptWrite,
  type ScriptRunOwner,
} from "./script-ledger.js";
import { recoverScriptWrites } from "./script-writes.js";

const databaseUrl = process.env.AGENT_RUN_POSTGRES_TEST_URL;
const coreIntegrationJob = process.env.GITHUB_JOB === "core-integration-tests";
if (process.env.CI && coreIntegrationJob && !databaseUrl) {
  throw new Error("AGENT_RUN_POSTGRES_TEST_URL is required in CI");
}

vi.mock("../audit/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../audit/store.js")>()),
  insertAuditEventOnce: vi.fn(async () => {}),
}));

vi.mock("../server/action-change-marker-write.js", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../server/action-change-marker-write.js")
  >()),
  writeActionChangeMarker: vi.fn(async () => {}),
}));

function executor(sql: postgres.Sql): DbExec {
  return {
    async execute(statement) {
      // raw-sql-ok: hands core's own composed statements to the test database as they are.
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

const runTag = randomUUID().replaceAll("-", "").slice(0, 12);
const RECEIPTS = `mcp_fence_spec_receipts_${runTag}`;
const THINGS = `mcp_fence_spec_things_${runTag}`;

let writerSql: postgres.Sql;
let checkSql: postgres.Sql;
let ledgerSql: postgres.Sql;
const checkName = `mcp-fence-${runTag}`;

beforeAll(async () => {
  if (!databaseUrl) return;
  writerSql = postgres(databaseUrl, { max: 2 });
  checkSql = postgres(databaseUrl, {
    max: 2,
    connection: { application_name: checkName },
  });
  ledgerSql = postgres(databaseUrl, { max: 2 });
  await ledgerSql.unsafe(`CREATE TABLE IF NOT EXISTS ${RECEIPTS} (
    scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    payload_digest TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('receipt', 'refusal')),
    PRIMARY KEY (scope, idempotency_key)
  )`);
  await ledgerSql.unsafe(`CREATE TABLE IF NOT EXISTS ${THINGS} (
    scope TEXT NOT NULL,
    thing_key TEXT NOT NULL
  )`);
  await withDbExec(executor(ledgerSql), () =>
    withMigrationRuntime(() => ensureScriptLedgerTables()),
  );
});

const pausedWork: (() => void)[] = [];
const runningWork: Promise<unknown>[] = [];

afterEach(async () => {
  for (const open of pausedWork.splice(0)) open();
  await Promise.all(runningWork.splice(0));
});

afterAll(async () => {
  if (!databaseUrl) return;
  await Promise.all([
    writerSql.end({ timeout: 5 }),
    checkSql.end({ timeout: 5 }),
  ]);
  await ledgerSql.unsafe(`DROP TABLE IF EXISTS ${RECEIPTS}`);
  await ledgerSql.unsafe(`DROP TABLE IF EXISTS ${THINGS}`);
  await ledgerSql.end();
});

async function fence(
  locator: McpScriptReceiptLocator,
): Promise<McpScriptFenceResult> {
  const stored = await checkSql.unsafe(
    `INSERT INTO ${RECEIPTS} (scope, idempotency_key, payload_digest, kind)
      VALUES ($1, $2, $3, 'refusal')
      ON CONFLICT (scope, idempotency_key) DO NOTHING
      RETURNING kind`,
    [locator.scope, locator.idempotencyKey, locator.payloadDigest],
  );
  if (stored.length > 0) return { status: "fenced" };
  const found = await storedRecord(locator);
  if (!found) throw new Error("The record under this key went missing.");
  return found.kind === "receipt"
    ? { status: "committed", receipt: locator.idempotencyKey }
    : { status: "fenced" };
}

async function reconcile(
  locator: McpScriptReceiptLocator,
): Promise<McpScriptReconcileResult> {
  const found = await storedRecord(locator);
  return found?.kind === "receipt"
    ? { status: "committed", receipt: locator.idempotencyKey }
    : { status: "absent" };
}

async function storedRecord(locator: McpScriptReceiptLocator) {
  const found = (
    await checkSql.unsafe(
      `SELECT kind, payload_digest FROM ${RECEIPTS}
      WHERE scope = $1 AND idempotency_key = $2`,
      [locator.scope, locator.idempotencyKey],
    )
  ).at(0);
  if (found && found.payload_digest !== locator.payloadDigest) {
    throw new Error("Another call's record holds this key.");
  }
  return found as { kind: "receipt" | "refusal" } | undefined;
}

function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  pausedWork.push(open);
  return { open, opened };
}

function startWrite(
  scope: string,
  key: string,
  options: {
    digest?: string;
    beforeReceipt?: Promise<void>;
    afterReceipt?: Promise<void>;
    failAfterReceipt?: boolean;
  } = {},
) {
  const receiptInserted = latch();
  const done = writerSql
    .begin(async (tx) => {
      await tx.unsafe(
        `INSERT INTO ${THINGS} (scope, thing_key) VALUES ($1, $2)`,
        [scope, key],
      );
      await options.beforeReceipt;
      await tx.unsafe(
        `INSERT INTO ${RECEIPTS} (scope, idempotency_key, payload_digest, kind)
          VALUES ($1, $2, $3, 'receipt')`,
        [scope, key, options.digest ?? `digest-${key}`],
      );
      receiptInserted.open();
      await options.afterReceipt;
      if (options.failAfterReceipt) throw new Error("The action failed.");
    })
    .then(
      () => ({ committed: true as const }),
      (error: { code?: string; message?: string }) => ({
        committed: false as const,
        code: error.code,
        message: error.message,
      }),
    );
  runningWork.push(done);
  return { done, receiptInserted: receiptInserted.opened };
}

async function untilCheckWaitsOnLock() {
  for (let tries = 0; tries < 100; tries += 1) {
    const [row] = await ledgerSql`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE application_name = ${checkName} AND wait_event_type = 'Lock'`;
    if (row.waiting > 0) return;
    // fixed-sleep-ok: polls pg_stat_activity until the check is waiting on the write's row lock
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The fence never waited on the write's lock.");
}

function scenario() {
  const t0 = Date.now() - 30 * 60_000;
  const scope = `scope-${randomUUID()}`;
  const owner: ScriptRunOwner = {
    appId: `app-${randomUUID()}`,
    runId: `run-${randomUUID()}`,
    ownerEmail: "ada@example.com",
    orgId: "org-1",
  };
  const entry = {
    tool: { description: "Saves a thing", parameters: undefined },
    schema: z.object({ key: z.string() }),
    readOnly: false,
    mcpScript: "write",
    mcpScriptWrite: {
      rowBound: () => 1,
      receiptLocator: (args: { key: string }) => locator(args.key),
      reconcile,
      fence,
      destructive: false,
    },
    run: async () => ({}),
  } as unknown as ActionEntry;

  function locator(key: string): McpScriptReceiptLocator {
    return { scope, idempotencyKey: key, payloadDigest: `digest-${key}` };
  }

  function ledger<T>(run: () => Promise<T>): Promise<T> {
    return withDbExec(executor(ledgerSql), run);
  }

  return {
    scope,
    locator,
    async pending(seq: number, key: string, windowMinutes = 2) {
      await ledger(() =>
        insertPendingScriptWrite(
          owner,
          {
            seq,
            functionName: "saveThing",
            action: "save-thing",
            args: { key },
            locator: locator(key),
            rowBound: 1,
            reservedRows: 1,
            recoverAfter: t0 + windowMinutes * 60_000,
          },
          t0,
        ),
      );
    },
    recover(minutesAfterStart: number) {
      const sweep = ledger(() =>
        recoverScriptWrites({
          appId: owner.appId,
          actions: { "save-thing": entry },
          now: t0 + minutesAfterStart * 60_000,
        }),
      );
      runningWork.push(sweep.catch(() => {}));
      return sweep;
    },
    async effect(seq: number): Promise<string> {
      const [row] = await ledgerSql`
        SELECT effect_status FROM mcp_script_calls
        WHERE app_id = ${owner.appId} AND run_id = ${owner.runId} AND seq = ${seq}`;
      return String(row.effect_status);
    },
    async things(): Promise<number> {
      const [row] = await ledgerSql.unsafe(
        `SELECT count(*)::int AS n FROM ${THINGS} WHERE scope = $1`,
        [scope],
      );
      return Number(row.n);
    },
    async records(): Promise<{ key: string; kind: string }[]> {
      const rows = await ledgerSql.unsafe(
        `SELECT idempotency_key, kind FROM ${RECEIPTS} WHERE scope = $1 ORDER BY idempotency_key`,
        [scope],
      );
      return rows.map((row) => ({
        key: String(row.idempotency_key),
        kind: String(row.kind),
      }));
    },
  };
}

// oracle-change: a new suite that needs PostgreSQL; CI's Core integration job provides one and fails without it.
describe.skipIf(!databaseUrl)(
  "MCP script write receipt fence on PostgreSQL",
  () => {
    it("fences a write that hasn't stored its receipt, so it can never commit", async () => {
      const s = scenario();
      await s.pending(0, "k1");
      const paused = latch();
      const write = startWrite(s.scope, "k1", {
        beforeReceipt: paused.opened,
      });

      expect(await s.recover(3)).toEqual({ settled: 1, unsettled: 0 });
      expect(await s.effect(0)).toBe("not-applied");

      paused.open();
      expect(await write.done).toMatchObject({
        committed: false,
        code: "23505",
      });
      expect(await startWrite(s.scope, "k1").done).toMatchObject({
        committed: false,
        code: "23505",
      });
      expect(await s.things()).toBe(0);
      expect(await s.records()).toEqual([{ key: "k1", kind: "refusal" }]);
    });

    it("waits on a write holding its receipt and settles committed when it commits", async () => {
      const s = scenario();
      await s.pending(0, "k1");
      const paused = latch();
      const write = startWrite(s.scope, "k1", { afterReceipt: paused.opened });
      await write.receiptInserted;

      let recovered = false;
      const recovery = s.recover(3).finally(() => {
        recovered = true;
      });
      await untilCheckWaitsOnLock();
      expect(recovered).toBe(false);

      paused.open();
      expect(await write.done).toEqual({ committed: true });
      expect(await recovery).toEqual({ settled: 1, unsettled: 0 });
      expect(await s.effect(0)).toBe("committed");
      expect(await s.things()).toBe(1);
      expect(await s.records()).toEqual([{ key: "k1", kind: "receipt" }]);
    });

    it("waits on a write holding its receipt and fences the key when it rolls back", async () => {
      const s = scenario();
      await s.pending(0, "k1");
      const paused = latch();
      const write = startWrite(s.scope, "k1", {
        afterReceipt: paused.opened,
        failAfterReceipt: true,
      });
      await write.receiptInserted;

      const recovery = s.recover(3);
      await untilCheckWaitsOnLock();
      paused.open();

      expect(await write.done).toMatchObject({ committed: false });
      expect(await recovery).toEqual({ settled: 1, unsettled: 0 });
      expect(await s.effect(0)).toBe("not-applied");
      expect(await s.things()).toBe(0);
      expect(await s.records()).toEqual([{ key: "k1", kind: "refusal" }]);
    });

    it("only reconciles before the window closes, so a slow write can still commit", async () => {
      const s = scenario();
      await s.pending(0, "k1", 10);
      const paused = latch();
      const write = startWrite(s.scope, "k1", {
        beforeReceipt: paused.opened,
      });

      expect(await s.recover(3)).toEqual({ settled: 0, unsettled: 1 });
      expect(await s.effect(0)).toBe("unknown");
      expect(await s.records()).toEqual([]);

      paused.open();
      expect(await write.done).toEqual({ committed: true });
      expect(await s.recover(4)).toEqual({ settled: 1, unsettled: 0 });
      expect(await s.effect(0)).toBe("committed");
    });

    it("agrees when two sweeps or two fences close the same key at once", async () => {
      const s = scenario();
      await s.pending(0, "k1");

      const [first, second] = await Promise.all([s.recover(3), s.recover(3)]);
      expect(first.settled + second.settled).toBe(1);
      expect(await s.effect(0)).toBe("not-applied");
      expect(
        await Promise.all([fence(s.locator("k2")), fence(s.locator("k2"))]),
      ).toEqual([{ status: "fenced" }, { status: "fenced" }]);
      expect(await s.records()).toEqual([
        { key: "k1", kind: "refusal" },
        { key: "k2", kind: "refusal" },
      ]);
    });

    it("leaves a write unknown when another call's receipt holds its key", async () => {
      const s = scenario();
      await s.pending(0, "k1");
      expect(
        await startWrite(s.scope, "k1", { digest: "digest-other" }).done,
      ).toEqual({ committed: true });

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(await s.recover(3)).toEqual({ settled: 0, unsettled: 1 });
      } finally {
        warn.mockRestore();
      }
      expect(await s.effect(0)).toBe("unknown");
      expect(await s.records()).toEqual([{ key: "k1", kind: "receipt" }]);
    });
  },
);
