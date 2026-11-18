import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import type { ProviderWriteHandler } from "./write-queue.js";

const database = new PGlite();
vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
    getDbExec: () => ({
      execute: async (input: string | { sql: string; args?: unknown[] }) => {
        const query = typeof input === "string" ? input : input.sql;
        const ledger = storeLedgerResult(query);
        if (ledger) return ledger;
        let index = 0;
        const result = await database.query(
          query.replace(/\?/g, () => `$${++index}`),
          typeof input === "string" ? [] : (input.args ?? []),
        );
        return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
      },
    }),
  };
});
const { providerWorkStore, reserveProviderBudget } =
  await import("./provider-budget.js");
const {
  enqueueProviderWrite,
  drainProviderWrites,
  getProviderWrite,
  listPendingProviderWriteScopes,
  reconcileProviderWrite,
  registerProviderWriteHandler,
  resumeProviderWriteForCaller,
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
const disposers: Array<() => void> = [];
beforeEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  providerWorkStore.reset();
  await providerWorkStore.ready();
  await database.exec(
    "TRUNCATE provider_connection_budgets, provider_read_cache, provider_write_queue",
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(10_000);
});
afterAll(async () => {
  for (const dispose of disposers) dispose();
  vi.useRealTimers();
  await database.close();
});
function register(
  execute: ProviderWriteHandler<
    z.infer<typeof inputSchema>,
    z.infer<typeof outputSchema>
  >["execute"],
  authorize = async () => {},
  options: Pick<
    ProviderWriteHandler<
      z.infer<typeof inputSchema>,
      z.infer<typeof outputSchema>
    >,
    "replaySafe" | "reconcile"
  > = {},
) {
  disposers.push(
    registerProviderWriteHandler(scope.appId, "event", {
      policy,
      parseInput: (value) => inputSchema.parse(value),
      parseResult: (value) => outputSchema.parse(value),
      authorize,
      execute,
      ...options,
    }),
  );
}

it("queues add/move/delete under exhaustion, survives handler restart, then completes in order", async () => {
  const effects: string[] = [];
  const execute = vi.fn(async (input: z.infer<typeof inputSchema>) => {
    effects.push(input.operation);
    return { saved: input.operation };
  });
  register(execute);
  await reserveProviderBudget(scope, policy);
  const queued = [];
  for (const operation of ["add", "move", "delete"] as const)
    queued.push(
      await enqueueProviderWrite({
        scope,
        operation: "event",
        idempotencyKey: operation,
        input: { operation },
      }),
    );
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "queued",
    reason: "budget_exhausted",
    resumeAt: 11_000,
  });
  expect(effects).toEqual([]);
  for (const dispose of disposers.splice(0)) dispose();
  register(execute);
  for (let index = 0; index < 3; index++) {
    vi.setSystemTime(11_001 + 1_001 * index);
    await Promise.all([drainProviderWrites(scope), drainProviderWrites(scope)]);
  }
  expect(effects).toEqual(["add", "move", "delete"]);
  for (const item of queued)
    expect(await getProviderWrite(scope, item.id)).toMatchObject({
      progress: { status: "completed" },
      result: { saved: expect.any(String) },
    });
  expect(
    await getProviderWrite({ ...scope, principalId: "other" }, queued[0].id),
  ).toBeNull();
});

it("deduplicates an intent and rejects reuse with a changed payload", async () => {
  const execute = vi.fn(async () => ({ saved: "once" }));
  register(execute);
  const options = {
    scope,
    operation: "event",
    idempotencyKey: "same",
    input: { operation: "add" },
  };
  const first = await enqueueProviderWrite(options);
  expect((await enqueueProviderWrite(options)).id).toBe(first.id);
  await expect(
    enqueueProviderWrite({ ...options, input: { operation: "delete" } }),
  ).rejects.toThrow("different intent");
  await drainProviderWrites(scope);
  await enqueueProviderWrite(options);
  await drainProviderWrites(scope);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("never repeats a write with an unknown outcome", async () => {
  const execute = vi.fn(async () => {
    throw new Error("response lost after provider accepted write");
  });
  register(execute);
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "unknown",
    input: { operation: "add" },
  });
  await drainProviderWrites(scope);
  vi.setSystemTime(99_000);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "uncertain", reason: "provider_outcome_unknown" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("does not let an uncertain caller block another caller, while sharing the allowance", async () => {
  const other = { ...scope, appId: "email", principalId: "person-b" };
  const execute = vi.fn(
    async (
      input: z.infer<typeof inputSchema>,
      context: { scope: typeof scope },
    ) => {
      if (context.scope.principalId === scope.principalId)
        throw new Error("first caller lost the response");
      return { saved: input.operation };
    },
  );
  register(execute);
  disposers.push(
    registerProviderWriteHandler(other.appId, "event", {
      policy,
      parseInput: (value) => inputSchema.parse(value),
      parseResult: (value) => outputSchema.parse(value),
      authorize: async () => {},
      execute,
    }),
  );
  const first = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "uncertain",
    input: { operation: "add" },
  });
  const second = await enqueueProviderWrite({
    scope: other,
    operation: "event",
    idempotencyKey: "independent",
    input: { operation: "move" },
  });
  await drainProviderWrites(scope);
  expect((await drainProviderWrites(other))[0]).toMatchObject({
    status: "queued",
    reason: "budget_exhausted",
    resumeAt: 11_000,
  });
  vi.setSystemTime(11_001);
  await drainProviderWrites(other);
  expect(await getProviderWrite(other, second.id)).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "move" },
  });
  expect(await getProviderWrite(scope, first.id)).toMatchObject({
    progress: { status: "uncertain" },
  });
  expect(execute).toHaveBeenCalledTimes(2);
});

it("keeps a pre-dispatch admission outage queued and retries after its resume time", async () => {
  let admissionAvailable = true;
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute, async () => {
    if (!admissionAvailable) throw new Error("authorization store unavailable");
  });
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "temporary-admission-outage",
    input: { operation: "add" },
  });
  admissionAvailable = false;
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "queued",
    reason: "admission_unavailable",
    resumeAt: 70_000,
  });
  expect(execute).not.toHaveBeenCalled();
  admissionAvailable = true;
  vi.setSystemTime(69_999);
  await drainProviderWrites(scope);
  expect(execute).not.toHaveBeenCalled();
  vi.setSystemTime(70_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "event-a" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each([false, true])(
  "only retries a reconciled missing write when upstream replay safety is %s",
  async (replaySafe) => {
    const execute = vi
      .fn<
        ProviderWriteHandler<
          z.infer<typeof inputSchema>,
          { saved: string }
        >["execute"]
      >()
      .mockRejectedValueOnce(new Error("provider response lost"))
      .mockResolvedValue({ saved: "event-a" });
    const reconcile = vi.fn(async () => ({ status: "not_applied" as const }));
    register(execute, async () => {}, { replaySafe, reconcile });
    const queued = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "reconcile-missing",
      input: { operation: "add" },
    });
    await drainProviderWrites(scope);
    expect(await reconcileProviderWrite(scope, queued.id)).toMatchObject({
      status: replaySafe ? "queued" : "uncertain",
    });
    vi.setSystemTime(11_001);
    await drainProviderWrites(scope);
    expect(execute).toHaveBeenCalledTimes(replaySafe ? 2 : 1);
    if (replaySafe) {
      expect(execute.mock.calls.map((call) => call[1].idempotencyKey)).toEqual([
        queued.id,
        queued.id,
      ]);
      expect(await getProviderWrite(scope, queued.id)).toMatchObject({
        progress: { status: "completed" },
      });
    }
  },
);

it("resolves a verified uncertain effect without resending the write", async () => {
  const execute = vi.fn(async () => {
    throw new Error("provider response lost");
  });
  register(execute, async () => {}, {
    reconcile: async () => ({
      status: "completed",
      result: { saved: "verified-existing-event" },
    }),
  });
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "reconcile-applied",
    input: { operation: "add" },
  });
  await drainProviderWrites(scope);
  expect(await reconcileProviderWrite(scope, queued.id)).toMatchObject({
    status: "completed",
  });
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    result: { saved: "verified-existing-event" },
  });
  await drainProviderWrites(scope);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("reauthorizes saved results and rejects a different authenticated caller", async () => {
  let allowed = true;
  const denied = new Error("grant revoked");
  const execute = vi.fn(async () => ({ saved: "private-event" }));
  register(execute, async () => {
    if (!allowed) throw denied;
  });
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "private-result",
    input: { operation: "add" },
  });
  await drainProviderWrites(scope);
  for (const caller of [
    { ...scope, principalId: "different-person" },
    { ...scope, tenantId: "different-workspace" },
    { ...scope, appId: "different-app" },
  ]) {
    expect(await resumeProviderWriteForCaller(caller, queued.id)).toBeNull();
  }
  allowed = false;
  await expect(getProviderWrite(scope, queued.id)).rejects.toBe(denied);
  await expect(resumeProviderWriteForCaller(scope, queued.id)).rejects.toBe(
    denied,
  );
  expect(execute).toHaveBeenCalledTimes(1);
});

it("restores pending scheduler scopes after registration restarts and rejects corrupt context", async () => {
  register(async () => ({ saved: "event-a" }));
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "scheduler-restart",
    input: { operation: "add" },
  });
  for (const dispose of disposers.splice(0)) dispose();
  register(async () => ({ saved: "event-a" }));
  expect(await listPendingProviderWriteScopes(scope.appId)).toEqual([scope]);
  expect(await listPendingProviderWriteScopes("another-app")).toEqual([]);
  await database.query(
    "UPDATE provider_write_queue SET scope_json = $1 WHERE id = $2",
    [JSON.stringify({ ...scope, principalId: "different-person" }), queued.id],
  );
  await expect(listPendingProviderWriteScopes(scope.appId)).rejects.toThrow(
    "does not match its scope",
  );
});

it("resumes a queued write from its durable scope for the authenticated caller", async () => {
  const execute = vi.fn(async () => ({ saved: "event-after-reload" }));
  register(execute);
  await reserveProviderBudget(scope, policy);
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "poll-after-reload",
    input: { operation: "add" },
  });
  expect(await resumeProviderWriteForCaller(scope, queued.id)).toMatchObject({
    progress: { status: "queued", reason: "budget_exhausted" },
  });
  expect(execute).not.toHaveBeenCalled();
  vi.setSystemTime(11_001);
  expect(await resumeProviderWriteForCaller(scope, queued.id)).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "event-after-reload" },
  });
  expect(await listPendingProviderWriteScopes(scope.appId)).toEqual([]);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("keeps an expired worker claim uncertain until its effect can be verified", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "worker-crash",
    input: { operation: "add" },
  });
  await database.query(
    "UPDATE provider_write_queue SET status = 'running', claim_id = 'abandoned-worker', lease_until = $1 WHERE id = $2",
    [11_000, queued.id],
  );
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "running" },
  });
  vi.setSystemTime(11_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "uncertain", reason: "lease_expired" },
  });
  expect(execute).not.toHaveBeenCalled();
});

it("does not coerce an unknown stored queue status into successful progress", async () => {
  register(async () => ({ saved: "event-a" }));
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "corrupt-status",
    input: { operation: "add" },
  });
  await database.query(
    "UPDATE provider_write_queue SET status = 'corrupt_state' WHERE id = $1",
    [queued.id],
  );
  await expect(getProviderWrite(scope, queued.id)).rejects.toMatchObject({
    code: "unknown_state",
  });
});

it("charges a queued transport attempt once and charges any further nested request separately", async () => {
  const admissions: string[] = [];
  register(async () => {
    admissions.push((await reserveProviderBudget(scope, policy)).status);
    admissions.push((await reserveProviderBudget(scope, policy)).status);
    return { saved: "once" };
  });
  await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "one-debit",
    input: { operation: "add" },
  });
  await drainProviderWrites(scope);
  expect(admissions).toEqual(["ready", "paused"]);
});
