import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import type { DbExec } from "../db/client.js";
import { SCHEMA_SNAPSHOT } from "../db/schema-snapshot.generated.js";

const executorContext = new AsyncLocalStorage<Pick<DbExec, "execute">>();
vi.mock("../db/client.js", () => ({
  isLocalDatabase: () => false,
  isProductionServerlessFunctionRuntime: () => false,
  getEnclosingTransactionDbExec: () => undefined,
  getDbExec: () => {
    const executor = executorContext.getStore();
    if (!executor)
      throw new Error("The integration test has no database scope");
    return executor;
  },
}));
const { providerWorkStore } = await import("./provider-budget.js");
const {
  enqueueProviderWrite,
  drainProviderWrites,
  registerProviderWriteHandler,
  providerWriteEnqueueStore,
} = await import("./write-queue.js");
const scope = {
  providerId: "calendar",
  tenantId: "workspace-a",
  connectionId: "account-a",
  appId: "schedule",
  principalId: "person-a",
};
const policy = { capacity: 1, windowMs: 1_000 };
const inputSchema = z.object({ operation: z.enum(["add", "move", "delete"]) });
const outputSchema = z.object({ saved: z.string() });
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(10_000);
});
afterEach(() => vi.useRealTimers());

it("serializes same-caller enqueues before sequence allocation across PostgreSQL connections", async () => {
  const { default: postgres } = await import("postgres");
  const url =
    process.env.PROVIDER_WRITE_POSTGRES_TEST_URL ??
    process.env.AGENT_RUN_POSTGRES_TEST_URL;
  if (!url)
    throw new Error("A local PostgreSQL integration fixture URL is required");
  const schema = `provider_fifo_${randomUUID().replaceAll("-", "")}`;
  const observer = postgres(url, { max: 1, onnotice: () => {} });
  const first = postgres(url, {
    max: 1,
    connection: { search_path: schema },
    onnotice: () => {},
  });
  const second = postgres(url, {
    max: 1,
    connection: { search_path: schema },
    onnotice: () => {},
  });
  // raw-sql-ok: test adapter forwards framework SQL with separate bound values to its isolated schema.
  const executor = (sql: typeof observer): Pick<DbExec, "execute"> => ({
    async execute(input) {
      if (typeof input !== "string" && !("sql" in input))
        throw new TypeError("Unexpected SQL fragment");
      const query =
        typeof input === "string" ? { sql: input, args: [] } : input;
      const { storeLedgerResult } =
        await import("../db/store-ledger.test-helpers.js");
      const ledger = storeLedgerResult(query.sql);
      if (ledger) return ledger;
      let index = 0;
      const rows = await sql.unsafe(
        query.sql.replace(/\?/g, () => `$${++index}`),
        (query.args ?? []) as never[],
      );
      return { rows: Array.from(rows), rowsAffected: rows.count };
    },
  });
  const observerExec = executor(observer);
  const firstExec = executor(first);
  const secondExec = executor(second);
  const gate = Math.floor(Math.random() * 2_000_000_000);
  let firstWrite: Promise<unknown> | undefined;
  let secondWrite: Promise<unknown> | undefined;
  const effects: string[] = [];
  let unregister: (() => void) | undefined;
  try {
    await observer.unsafe(`CREATE SCHEMA ${schema}`);
    await observer.unsafe(`SET search_path TO ${schema}`);
    for (const statement of SCHEMA_SNAPSHOT.statements) {
      if (
        statement.startsWith('CREATE TABLE "application_state"') ||
        statement.startsWith('ALTER TABLE "application_state"') ||
        statement.includes(" ON public.application_state ")
      )
        await observer.unsafe(
          statement.replaceAll("public.application_state", "application_state"),
        );
    }
    providerWorkStore.reset();
    providerWriteEnqueueStore.reset();
    for (const exec of [observerExec, firstExec, secondExec])
      await executorContext.run(exec, async () => {
        await providerWorkStore.ready();
        await providerWriteEnqueueStore.ready();
      });
    unregister = registerProviderWriteHandler(scope.appId, "event", {
      policy,
      parseInput: (value) => inputSchema.parse(value),
      parseResult: (value) => outputSchema.parse(value),
      authorize: async () => {},
      execute: async ({ operation }) => {
        effects.push(operation);
        return { saved: operation };
      },
    });
    await observer.unsafe(`CREATE FUNCTION hold_first() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.input_json::jsonb->>'operation' = 'add' THEN PERFORM pg_advisory_xact_lock(${gate}); END IF;
        RETURN NEW;
      END $$`);
    await observer.unsafe(
      "CREATE TRIGGER hold_first BEFORE INSERT ON provider_write_queue FOR EACH ROW EXECUTE FUNCTION hold_first()",
    );
    await observer`SELECT pg_advisory_lock(${gate})`;
    const firstBackend = (await first`SELECT pg_backend_pid() AS pid`).at(0);
    const secondBackend = (await second`SELECT pg_backend_pid() AS pid`).at(0);
    if (!firstBackend || !secondBackend)
      throw new Error("PostgreSQL fixture backend identities are unavailable");
    const firstPid = firstBackend.pid;
    const secondPid = secondBackend.pid;
    firstWrite = executorContext.run(firstExec, () =>
      enqueueProviderWrite({
        scope,
        operation: "event",
        idempotencyKey: "first",
        input: { operation: "add" },
      }),
    );
    await expect
      .poll(async () => {
        const row = (
          await observer`SELECT wait_event FROM pg_stat_activity WHERE pid = ${firstPid}`
        ).at(0);
        if (!row) throw new Error("PostgreSQL fixture backend is unavailable");
        return row.wait_event;
      })
      .toBe("advisory");
    let secondCommitted = false;
    secondWrite = executorContext.run(secondExec, () =>
      enqueueProviderWrite({
        scope,
        operation: "event",
        idempotencyKey: "second",
        input: { operation: "move" },
      }),
    );
    void secondWrite.then(() => {
      secondCommitted = true;
    });
    await expect
      .poll(async () => {
        const row = (
          await observer`SELECT ${firstPid} = ANY(pg_blocking_pids(${secondPid})) AS blocked`
        ).at(0);
        if (!row)
          throw new Error("PostgreSQL fixture lock observation is unavailable");
        return secondCommitted
          ? "committed"
          : row.blocked
            ? "blocked"
            : "pending";
      })
      .toBe("blocked");
    await executorContext.run(observerExec, async () => {
      await enqueueProviderWrite({
        scope: { ...scope, principalId: "other" },
        operation: "event",
        idempotencyKey: "independent",
        input: { operation: "delete" },
      });
      await drainProviderWrites(scope);
    });
    expect(effects).toEqual([]);
    await observer`SELECT pg_advisory_unlock(${gate})`;
    expect(await Promise.all([firstWrite, secondWrite])).toMatchObject([
      { progress: { status: "queued" } },
      { progress: { status: "queued" } },
    ]);
    await executorContext.run(observerExec, async () => {
      expect(await drainProviderWrites(scope, { maxItems: 1 })).toMatchObject([
        { status: "completed" },
      ]);
      vi.setSystemTime(Date.now() + policy.windowMs + 1);
      expect(await drainProviderWrites(scope, { maxItems: 1 })).toMatchObject([
        { status: "completed", reason: null, resumeAt: null },
      ]);
    });
    expect(effects).toEqual(["add", "move"]);
    const completedReceipts =
      await observer`SELECT completion_notified_at IS NOT NULL AS notified
      FROM provider_write_queue WHERE status = 'completed' ORDER BY position`;
    expect(completedReceipts).toMatchObject([
      { notified: true },
      { notified: true },
    ]);
  } finally {
    await observer`SELECT pg_advisory_unlock(${gate})`;
    await Promise.allSettled([firstWrite, secondWrite]);
    await Promise.all([first.end(), second.end()]);
    await observer.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await observer.end();
    providerWorkStore.reset();
    providerWriteEnqueueStore.reset();
    unregister?.();
  }
});
