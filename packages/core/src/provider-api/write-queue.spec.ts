import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { ActionContractError } from "../action.js";
import type { DbExec } from "../db/client.js";
import type { ProviderWriteHandler } from "./write-queue.js";

const database = new PGlite();
const executorContext = new AsyncLocalStorage<Pick<DbExec, "execute">>();
vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
    getDbExec: () =>
      executorContext.getStore() ?? {
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
      },
  };
});
const { ProviderDeferredError, providerWorkStore, reserveProviderBudget } =
  await import("./provider-budget.js");
const {
  enqueueProviderWrite,
  abandonProviderWrite,
  abandonProviderWriteForCaller,
  drainProviderWrites,
  getProviderWrite,
  listPendingProviderWriteScopes,
  reconcileProviderWrite,
  registerProviderWriteHandler,
  resumeProviderWriteForCaller,
  ProviderWriteNotDispatchedError,
  providerWriteSchedulerStore,
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
const disposers: Array<() => void> = [];
beforeEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  providerWorkStore.reset();
  providerWriteSchedulerStore.reset();
  providerWriteEnqueueStore.reset();
  await providerWorkStore.ready();
  await providerWriteSchedulerStore.ready();
  await providerWriteEnqueueStore.ready();
  await database.exec(
    "TRUNCATE provider_connection_budgets, provider_read_cache, provider_write_queue, provider_write_scheduler_cursor, provider_write_enqueue_lock",
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(10_000);
});
afterAll(async () => {
  for (const dispose of disposers) dispose();
  vi.useRealTimers();
  await database.close();
});
afterEach(() => vi.useRealTimers());
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
    if (!admissionAvailable)
      throw new ActionContractError("Authorization storage is unavailable.", {
        errorCode: "authorization_storage_unavailable",
        statusCode: 503,
      });
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

it("reads durable caller progress without executing a queue of provider writes", async () => {
  const execute = vi.fn(async () => ({ saved: "event-after-reload" }));
  disposers.push(
    registerProviderWriteHandler(scope.appId, "event", {
      policy: { capacity: 50, windowMs: 60_000 },
      parseInput: (value) => inputSchema.parse(value),
      parseResult: (value) => outputSchema.parse(value),
      authorize: async () => {},
      execute,
    }),
  );
  const queued = [];
  for (let index = 0; index < 21; index++)
    queued.push(
      await enqueueProviderWrite({
        scope,
        operation: "event",
        idempotencyKey: `poll-after-reload-${index}`,
        input: { operation: "add" },
      }),
    );
  expect(await resumeProviderWriteForCaller(scope, queued[0].id)).toMatchObject(
    {
      progress: { status: "queued", attempts: 0 },
    },
  );
  expect(execute).not.toHaveBeenCalled();
  await drainProviderWrites(scope, { maxItems: 1 });
  expect(await resumeProviderWriteForCaller(scope, queued[0].id)).toMatchObject(
    {
      progress: { status: "completed" },
      result: { saved: "event-after-reload" },
    },
  );
  expect(execute).toHaveBeenCalledTimes(1);
  expect(await resumeProviderWriteForCaller(scope, queued[1].id)).toMatchObject(
    {
      progress: { status: "queued", attempts: 0 },
    },
  );
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

it("leaves an unavailable handler queued without claiming an attempt and resumes after it returns", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "handler-restart",
    input: { operation: "add" },
  });
  for (const dispose of disposers.splice(0)) dispose();
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "queued",
    attempts: 0,
    reason: "handler_unavailable",
    resumeAt: 70_000,
  });
  expect(execute).not.toHaveBeenCalled();
  register(execute);
  vi.setSystemTime(70_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "completed", attempts: 1 },
    result: { saved: "event-a" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("terminates a confirmed authorization rejection instead of retrying it as an outage", async () => {
  let authorized = true;
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute, async () => {
    if (!authorized)
      throw new ActionContractError("The connection grant was removed.", {
        errorCode: "connection_revoked",
        statusCode: 403,
      });
  });
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "authorization-rejected",
    input: { operation: "add" },
  });
  authorized = false;
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "failed",
    reason: "authorization_rejected",
    resumeAt: null,
  });
  vi.setSystemTime(80_000);
  expect(await drainProviderWrites(scope)).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
});

it("fails an invalid stored input before admission instead of retrying a corrupt intent", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "invalid-stored-input",
    input: { operation: "add" },
  });
  await database.query(
    "UPDATE provider_write_queue SET input_json = $1 WHERE id = $2",
    [JSON.stringify({ operation: "invalid" }), queued.id],
  );
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "failed",
    reason: "invalid_input",
    resumeAt: null,
  });
  expect(execute).not.toHaveBeenCalled();
  expect(await reserveProviderBudget(scope, policy)).toEqual({
    status: "ready",
  });
});

it("retains an unexecuted intent through a persisted budget policy mismatch and completes it after repair", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  await reserveProviderBudget(scope, { ...policy, capacity: 2 });
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "policy-repair",
    input: { operation: "add" },
  });
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "queued",
    reason: "admission_unavailable",
    resumeAt: 70_000,
  });
  expect(execute).not.toHaveBeenCalled();
  expect(await drainProviderWrites(scope)).toEqual([]);
  // Repair the persisted configuration in this isolated connection's budget.
  await database.query("UPDATE provider_connection_budgets SET capacity = $1", [
    policy.capacity,
  ]);
  vi.setSystemTime(70_001);
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "completed",
  });
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { id: queued.id, status: "completed" },
    result: { saved: "event-a" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each(["oversized", "malformed"] as const)(
  "marks an applied write with an %s result unavailable immediately and never resends it",
  async (kind) => {
    const execute = vi.fn(async () =>
      kind === "oversized" ? { saved: "x".repeat(65_536) } : { saved: 42 },
    );
    disposers.push(
      registerProviderWriteHandler<z.infer<typeof inputSchema>, unknown>(
        scope.appId,
        "event",
        {
          policy,
          parseInput: (value) => inputSchema.parse(value),
          parseResult: (value) => outputSchema.parse(value),
          authorize: async () => {},
          execute,
        },
      ),
    );
    const queued = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: `unavailable-${kind}-result`,
      input: { operation: "add" },
    });
    expect((await drainProviderWrites(scope))[0]).toMatchObject({
      id: queued.id,
      status: "uncertain",
      reason: "result_unavailable",
      attempts: 1,
    });
    expect(await getProviderWrite(scope, queued.id)).toEqual({
      progress: {
        id: queued.id,
        status: "uncertain",
        reason: "result_unavailable",
        attempts: 1,
        resumeAt: null,
      },
    });
    vi.setSystemTime(200_000);
    await drainProviderWrites(scope);
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it("renews a live worker lease so another drain cannot orphan or replay its long-running write", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(10_000);
  let announceStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    announceStarted = resolve;
  });
  let completeProvider: (value: { saved: string }) => void = () => {};
  const providerResponse = new Promise<{ saved: string }>((resolve) => {
    completeProvider = resolve;
  });
  const execute = vi.fn(async () => {
    announceStarted();
    return providerResponse;
  });
  register(execute);
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "long-running-provider-write",
    input: { operation: "add" },
  });
  const firstWorker = drainProviderWrites(scope, { maxItems: 1 });
  try {
    await started;
    await vi.advanceTimersByTimeAsync(130_000);
    expect(await drainProviderWrites(scope, { maxItems: 1 })).toEqual([]);
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: { status: "running", attempts: 1 },
    });
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    completeProvider({ saved: "long-running-event" });
    await firstWorker;
  }
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "completed", attempts: 1 },
    result: { saved: "long-running-event" },
  });
  expect(vi.getTimerCount()).toBe(0);
});

it("never requeues a deferral after a provider effect when replay safety was not declared", async () => {
  const applied: string[] = [];
  const execute = vi.fn(async () => {
    applied.push("created-event");
    throw new ProviderDeferredError({
      status: "paused",
      reason: "budget_exhausted",
      resumeAt: Date.now() + 1_000,
    });
  });
  register(execute);
  const queued = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "effect-before-deferral",
    input: { operation: "add" },
  });
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "uncertain",
    reason: "provider_outcome_unknown",
  });
  vi.setSystemTime(11_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "uncertain" },
  });
  expect(applied).toEqual(["created-event"]);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("settles an untyped authorization failure instead of retrying it as an admission outage", async () => {
  let authorized = true;
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute, async () => {
    if (!authorized) throw new Error();
  });
  await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "untyped-authorization-failure",
    input: { operation: "add" },
  });
  authorized = false;
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "failed",
    reason: "authorization_failed",
    resumeAt: null,
  });
  vi.setSystemTime(80_000);
  expect(await drainProviderWrites(scope)).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
});

it.each([false, true])(
  "retries a no-effect deferral when replay safety is %s using its explicit contract",
  async (replaySafe) => {
    const execute = vi.fn(async () => ({ saved: "event-a" }));
    execute.mockRejectedValueOnce(
      replaySafe
        ? new ProviderDeferredError({
            status: "paused",
            reason: "budget_exhausted",
            resumeAt: 11_000,
          })
        : new ProviderWriteNotDispatchedError({
            status: "paused",
            reason: "operator",
            resumeAt: 11_000,
          }),
    );
    register(execute, async () => {}, { replaySafe });
    const queued = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "safe-defer",
      input: { operation: "add" },
    });
    expect((await drainProviderWrites(scope))[0]).toMatchObject({
      status: "queued",
      resumeAt: 11_000,
    });
    vi.setSystemTime(11_001);
    await drainProviderWrites(scope);
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: { status: "completed" },
      result: { saved: "event-a" },
    });
    expect(execute).toHaveBeenCalledTimes(2);
  },
);

it("rotates parked scheduler scopes durably so later callers are visited within bounded sweeps", async () => {
  register(async () => ({ saved: "event-a" }));
  const expected = [];
  for (let index = 0; index < 25; index++) {
    const pendingScope = { ...scope, principalId: `person-${index}` };
    expected.push(pendingScope.principalId);
    await enqueueProviderWrite({
      scope: pendingScope,
      operation: "event",
      idempotencyKey: "parked",
      input: { operation: "add" },
    });
  }
  await database.exec(`UPDATE provider_write_queue SET status = 'uncertain'
    WHERE position IN (SELECT position FROM provider_write_queue ORDER BY position LIMIT 20)`);
  const first = await listPendingProviderWriteScopes(scope.appId, 20);
  expect(first.map((item) => item.principalId)).toEqual(expected.slice(0, 20));
  providerWriteSchedulerStore.reset();
  const second = await listPendingProviderWriteScopes(scope.appId, 20);
  expect(second).toHaveLength(20);
  expect(
    new Set([...first, ...second].map((item) => item.principalId)),
  ).toEqual(new Set(expected));
});

it("allocates concurrent scheduler batches without losing the persisted rotation", async () => {
  register(async () => ({ saved: "event-a" }));
  for (let index = 0; index < 4; index++)
    await enqueueProviderWrite({
      scope: { ...scope, principalId: `person-${index}` },
      operation: "event",
      idempotencyKey: "concurrent-scopes",
      input: { operation: "add" },
    });
  const batches = await Promise.all([
    listPendingProviderWriteScopes(scope.appId, 2),
    listPendingProviderWriteScopes(scope.appId, 2),
  ]);
  expect(batches.map((batch) => batch.length)).toEqual([2, 2]);
  expect(new Set(batches.flat().map((item) => item.principalId))).toEqual(
    new Set(["person-0", "person-1", "person-2", "person-3"]),
  );
});

it("explicitly abandons an unreconcilable uncertain head without replay, then unblocks later intents", async () => {
  const effects: string[] = [];
  let authorized = true;
  register(
    async ({ operation }) => {
      effects.push(operation);
      if (operation === "add")
        throw new Error("effect accepted; response lost");
      return { saved: operation };
    },
    async () => {
      if (!authorized)
        throw new ActionContractError("Access revoked", {
          statusCode: 403,
          errorCode: "forbidden",
        });
    },
  );
  const uncertain = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "ambiguous",
    input: { operation: "add" },
  });
  const later = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "later",
    input: { operation: "move" },
  });
  await drainProviderWrites(scope);
  expect(await drainProviderWrites(scope)).toEqual([]);
  expect(
    await abandonProviderWrite(
      { ...scope, principalId: "other" },
      uncertain.id,
    ),
  ).toBeNull();
  expect(
    await abandonProviderWrite(
      { ...scope, connectionId: "other" },
      uncertain.id,
    ),
  ).toBeNull();
  const caller = {
    appId: scope.appId,
    tenantId: scope.tenantId,
    principalId: scope.principalId,
  };
  for (const invalidCaller of [
    { ...caller, appId: "other" },
    { ...caller, tenantId: "other" },
    { ...caller, principalId: "other" },
  ])
    expect(
      await abandonProviderWriteForCaller(invalidCaller, uncertain.id),
    ).toBeNull();
  authorized = false;
  await expect(
    abandonProviderWriteForCaller(caller, uncertain.id),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(
    (
      await database.query(
        "SELECT status FROM provider_write_queue WHERE id = $1",
        [uncertain.id],
      )
    ).rows,
  ).toEqual([{ status: "uncertain" }]);
  authorized = true;
  expect(
    await abandonProviderWriteForCaller(caller, uncertain.id),
  ).toMatchObject({
    status: "failed",
    reason: "outcome_abandoned",
    attempts: 1,
  });
  expect(await abandonProviderWrite(scope, uncertain.id)).toMatchObject({
    reason: "outcome_abandoned",
  });
  vi.setSystemTime(11_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, later.id)).toMatchObject({
    progress: { status: "completed" },
  });
  // Retrying the original intent still resolves to its abandoned record.
  expect(
    await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "ambiguous",
      input: { operation: "add" },
    }),
  ).toMatchObject({ status: "failed", reason: "outcome_abandoned" });
  await drainProviderWrites(scope);
  expect(effects).toEqual(["add", "move"]);
});

it("rejects abandonment of a queued or live running write", async () => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  register(async () => {
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { saved: "event-a" };
  });
  const write = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "live",
    input: { operation: "add" },
  });
  await expect(abandonProviderWrite(scope, write.id)).rejects.toMatchObject({
    statusCode: 409,
    errorCode: "provider_write_not_uncertain",
  });
  const drain = drainProviderWrites(scope);
  try {
    await running;
    await expect(abandonProviderWrite(scope, write.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  } finally {
    release();
    await drain;
  }
  expect(await getProviderWrite(scope, write.id)).toMatchObject({
    progress: { status: "completed" },
  });
});

// Opt-in shared-PostgreSQL fixture, isolated in a unique schema; PGlite has only
// one session and cannot reproduce visibility between concurrent transactions.
it.skipIf(!process.env.PROVIDER_WRITE_POSTGRES_TEST_URL)(
  "serializes same-caller enqueues before sequence allocation across PostgreSQL connections",
  async () => {
    const { default: postgres } = await import("postgres");
    const url = process.env.PROVIDER_WRITE_POSTGRES_TEST_URL!;
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
    try {
      await observer.unsafe(`CREATE SCHEMA ${schema}`);
      await observer.unsafe(`SET search_path TO ${schema}`);
      providerWorkStore.reset();
      providerWriteEnqueueStore.reset();
      for (const exec of [observerExec, firstExec, secondExec])
        await executorContext.run(exec, async () => {
          await providerWorkStore.ready();
          await providerWriteEnqueueStore.ready();
        });
      register(async ({ operation }) => {
        effects.push(operation);
        return { saved: operation };
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
      const [{ pid: firstPid }] = await first`SELECT pg_backend_pid() AS pid`;
      const [{ pid: secondPid }] = await second`SELECT pg_backend_pid() AS pid`;
      firstWrite = executorContext.run(firstExec, () =>
        enqueueProviderWrite({
          scope,
          operation: "event",
          idempotencyKey: "first",
          input: { operation: "add" },
        }),
      );
      await expect
        .poll(
          async () =>
            (
              await observer`SELECT wait_event FROM pg_stat_activity WHERE pid = ${firstPid}`
            )[0].wait_event,
        )
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
          const [row] =
            await observer`SELECT ${firstPid} = ANY(pg_blocking_pids(${secondPid})) AS blocked`;
          return secondCommitted
            ? "committed"
            : row.blocked
              ? "blocked"
              : "pending";
        })
        .toBe("blocked");
      await executorContext.run(observerExec, async () => {
        // Another caller remains independent while this caller's first insert is uncommitted.
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
      await Promise.all([firstWrite, secondWrite]);
      await executorContext.run(observerExec, async () => {
        expect(await drainProviderWrites(scope, { maxItems: 1 })).toMatchObject(
          [{ status: "completed" }],
        );
        vi.setSystemTime(Date.now() + policy.windowMs + 1);
        expect(await drainProviderWrites(scope, { maxItems: 1 })).toMatchObject(
          [{ status: "completed", reason: null, resumeAt: null }],
        );
      });
      expect(effects).toEqual(["add", "move"]);
    } finally {
      await observer`SELECT pg_advisory_unlock(${gate})`;
      await Promise.allSettled([firstWrite, secondWrite]);
      await Promise.all([first.end(), second.end()]);
      await observer.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await observer.end();
      providerWorkStore.reset();
      providerWriteEnqueueStore.reset();
    }
  },
);
