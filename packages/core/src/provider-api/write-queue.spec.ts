import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";

import { ActionContractError } from "../action.js";
import type {
  ProviderWriteHandler,
  ProviderWriteProgress,
  ProviderWriteScope,
} from "./write-queue.js";

const completionMarker = vi.hoisted(() => vi.fn());
vi.mock("../server/action-change-marker-write.js", () => ({
  writeActionChangeMarker: completionMarker,
}));

const database = new PGlite();
let afterQuery:
  | ((rows: Record<string, unknown>[]) => void | Promise<void>)
  | undefined;
vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
    getEnclosingTransactionDbExec: () => undefined,
    isLocalDatabase: () => true,
    isProductionServerlessFunctionRuntime: () => false,
    getDbExec: () => ({
      execute: async (input: string | { sql: string; args?: unknown[] }) => {
        const query = typeof input === "string" ? input : input.sql;
        const ledger = storeLedgerResult(query);
        if (ledger) return ledger;
        let index = 0;
        const result = await database.query<Record<string, unknown>>(
          query.replace(/\?/g, () => `$${++index}`),
          typeof input === "string" ? [] : (input.args ?? []),
        );
        await afterQuery?.(result.rows);
        return { rows: result.rows, rowsAffected: result.affectedRows ?? 0 };
      },
    }),
  };
});
const { ProviderDeferredError, providerWorkStore, reserveProviderBudget } =
  await import("./provider-budget.js");
const { registerProviderBudgetGate } =
  await import("./provider-budget-gate.js");
const { fetchWithProviderCallGate, registerProviderCallGate } =
  await import("./call-gates.js");
const {
  enqueueProviderWrite,
  abandonProviderWrite,
  abandonProviderWriteForCaller,
  cancelQueuedProviderWrite,
  cancelQueuedProviderWriteForCaller,
  drainProviderWrites,
  getProviderWrite,
  listPendingProviderWriteScopes,
  ProviderWriteSchedulerScopeError,
  reconcileProviderWrite,
  registerProviderWriteHandler,
  registerProviderWriteAuthorizer,
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
  afterQuery = undefined;
  completionMarker.mockReset();
  completionMarker.mockResolvedValue(undefined);
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
    "replaySafe" | "reconcile" | "dispatchTracking"
  > = {},
) {
  const dispose = registerProviderWriteHandler(scope.appId, "event", {
    policy,
    parseInput: (value) => inputSchema.parse(value),
    parseResult: (value) => outputSchema.parse(value),
    authorize,
    execute,
    ...options,
  });
  disposers.push(dispose);
  return dispose;
}

it.each([undefined, null])(
  "preserves the distinction between omitted and explicit null server context: %j",
  async (metadata) => {
    const executed: unknown[] = [];
    register(async (_input, context) => {
      executed.push(context.metadata);
      return { saved: "event-a" };
    });
    await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "nullable-context",
      input: { operation: "add" },
      ...(metadata === undefined ? {} : { metadata }),
    });
    await drainProviderWrites(scope);
    expect(executed).toEqual([metadata]);
  },
);

it("retains each intent's server context across retries execution and reconciliation", async () => {
  const executed: unknown[] = [];
  const reconciled: unknown[] = [];
  register(
    async (input, context) => {
      executed.push(context.metadata);
      if (input.operation === "add")
        throw new Error("Provider result was lost");
      return { saved: input.operation };
    },
    async () => {},
    {
      reconcile: async (_input, context) => {
        reconciled.push(context.metadata);
        return { status: "completed", result: { saved: "add" } };
      },
    },
  );
  const metadata = { foreground: true };
  const first = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "context-first",
    input: { operation: "add" },
    metadata,
  });
  metadata.foreground = false;
  const retry = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "context-first",
    input: { operation: "add" },
    metadata,
  });
  expect(retry.progress.id).toBe(first.progress.id);
  await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "context-next",
    input: { operation: "move" },
    metadata: { foreground: false },
  });
  await drainProviderWrites(scope, { maxItems: 1 });
  expect(await reconcileProviderWrite(scope, first.progress.id)).toMatchObject({
    status: "completed",
  });
  vi.setSystemTime(11_001);
  await drainProviderWrites(scope);
  expect(executed).toEqual([{ foreground: true }, { foreground: false }]);
  expect(reconciled).toEqual([{ foreground: true }]);
});

it.each([Number.NaN, { flag: undefined }, new Date(0)])(
  "rejects non-JSON server context before accepting an intent: %j",
  async (metadata) => {
    register(async () => ({ saved: "event-a" }));
    await expect(
      enqueueProviderWrite({
        scope,
        operation: "event",
        idempotencyKey: "invalid-context",
        input: { operation: "add" },
        metadata,
      }),
    ).rejects.toThrow("only JSON values");
    expect(
      (
        await database.query(
          "SELECT count(*)::int AS count FROM provider_write_queue",
        )
      ).rows,
    ).toEqual([{ count: 0 }]);
  },
);

it("retains the selected handler when it disappears while its claim commits", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  const unregister = register(execute);
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "handler-unload-during-claim",
    input: { operation: "add" },
  });
  let removed = false;
  afterQuery = (rows) => {
    if (
      rows.some(
        (row) =>
          row.id === queued.id &&
          row.status === "running" &&
          typeof row.input_json === "string",
      )
    ) {
      afterQuery = undefined;
      unregister();
      removed = true;
    }
  };

  await expect(drainProviderWrites(scope)).resolves.toMatchObject([
    { id: queued.id, status: "completed" },
  ]);
  expect(removed).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    (
      await database.query(
        "SELECT status, claim_id, claim_phase FROM provider_write_queue WHERE id = $1",
        [queued.id],
      )
    ).rows,
  ).toEqual([{ status: "completed", claim_id: null, claim_phase: null }]);
});

it("does not claim a different operation when another worker completes the selected head", async () => {
  const firstExecute = vi.fn(async () => ({ saved: "first" }));
  const secondExecute = vi.fn(async () => ({ saved: "second" }));
  register(firstExecute);
  disposers.push(
    registerProviderWriteHandler(scope.appId, "other-event", {
      policy,
      parseInput: (value) => inputSchema.parse(value),
      parseResult: (value) => outputSchema.parse(value),
      authorize: async () => {},
      execute: secondExecute,
    }),
  );
  const { progress: first } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "selected-head",
    input: { operation: "add" },
  });
  const { progress: second } = await enqueueProviderWrite({
    scope,
    operation: "other-event",
    idempotencyKey: "next-operation",
    input: { operation: "move" },
  });
  let competingDrain: ProviderWriteProgress[] | undefined;
  afterQuery = async (rows) => {
    if (
      rows.some(
        (row) =>
          row.id === first.id &&
          row.status === "queued" &&
          row.operation === "event",
      )
    ) {
      afterQuery = undefined;
      competingDrain = await drainProviderWrites(scope, { maxItems: 1 });
      vi.setSystemTime(11_001);
    }
  };

  expect(await drainProviderWrites(scope)).toEqual([]);
  expect(competingDrain).toMatchObject([{ id: first.id, status: "completed" }]);
  expect(firstExecute).toHaveBeenCalledTimes(1);
  expect(secondExecute).not.toHaveBeenCalled();
  expect(await drainProviderWrites(scope)).toMatchObject([
    { id: second.id, status: "completed" },
  ]);
  expect(secondExecute).toHaveBeenCalledTimes(1);
});

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
    expect(await getProviderWrite(scope, item.progress.id)).toMatchObject({
      progress: { status: "completed" },
      result: { saved: expect.any(String) },
    });
  expect(
    await getProviderWrite(
      { ...scope, principalId: "other" },
      queued[0].progress.id,
    ),
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
  const { progress: first } = await enqueueProviderWrite(options);
  expect((await enqueueProviderWrite(options)).progress.id).toBe(first.id);
  await expect(
    enqueueProviderWrite({ ...options, input: { operation: "delete" } }),
  ).rejects.toThrow("different intent");
  await drainProviderWrites(scope);
  expect(await enqueueProviderWrite(options)).toMatchObject({
    progress: { id: first.id, status: "completed" },
    result: { saved: "once" },
  });
  await drainProviderWrites(scope);
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each(["queued", "uncertain"] as const)(
  "uses current app authorization to inspect and stop a retired %s operation",
  async (status) => {
    let allowed = true;
    const denied = new ActionContractError("Current app grant revoked", {
      errorCode: "forbidden",
      statusCode: 403,
    });
    const execute = vi.fn(async () => {
      if (status === "uncertain") throw new Error("provider outcome unknown");
      return { saved: "event-a" };
    });
    const unregister = register(execute);
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "retired-operation",
      input: { operation: "add" },
    });
    if (status === "uncertain")
      await drainProviderWrites(scope, { maxItems: 1 });
    unregister();
    const authorize = vi.fn(async (currentScope) => {
      expect(currentScope).toEqual(scope);
      if (!allowed) throw denied;
    });
    disposers.push(registerProviderWriteAuthorizer(scope.appId, authorize));
    expect(await resumeProviderWriteForCaller(scope, queued.id)).toEqual({
      progress: expect.objectContaining({ id: queued.id, status }),
    });
    expect(
      await getProviderWrite({ ...scope, principalId: "other" }, queued.id),
    ).toBeNull();
    expect(
      await cancelQueuedProviderWriteForCaller(
        { ...scope, tenantId: "other" },
        queued.id,
      ),
    ).toBeNull();
    expect(authorize).toHaveBeenCalledTimes(1);
    allowed = false;
    await expect(getProviderWrite(scope, queued.id)).rejects.toBe(denied);
    const stop =
      status === "queued"
        ? cancelQueuedProviderWriteForCaller
        : abandonProviderWriteForCaller;
    await expect(stop(scope, queued.id)).rejects.toBe(denied);
    expect(
      (
        await database.query(
          "SELECT status FROM provider_write_queue WHERE id = $1",
          [queued.id],
        )
      ).rows,
    ).toEqual([{ status }]);
    allowed = true;
    expect(await stop(scope, queued.id)).toMatchObject({
      status: "failed",
      reason: "outcome_abandoned",
    });
    expect(execute).toHaveBeenCalledTimes(status === "uncertain" ? 1 : 0);
  },
);

it("fails closed without a fallback and never discloses a completed result without its operation parser", async () => {
  const unregister = register(async () => ({ saved: "private-result" }));
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "retired-completed",
    input: { operation: "add" },
  });
  await drainProviderWrites(scope);
  unregister();
  await expect(getProviderWrite(scope, queued.id)).rejects.toMatchObject({
    errorCode: "provider_write_handler_unavailable",
    statusCode: 503,
  });
  const authorize = vi.fn(async () => {});
  const unregisterAuthorizer = registerProviderWriteAuthorizer(
    scope.appId,
    authorize,
  );
  disposers.push(unregisterAuthorizer);
  await expect(getProviderWrite(scope, queued.id)).rejects.toMatchObject({
    errorCode: "provider_write_handler_unavailable",
    statusCode: 503,
  });
  expect(authorize).toHaveBeenCalledTimes(1);
  unregisterAuthorizer();
  await expect(
    cancelQueuedProviderWrite(scope, queued.id),
  ).rejects.toMatchObject({
    errorCode: "provider_write_handler_unavailable",
    statusCode: 503,
  });
});

it("keeps operation authorization authoritative and never uses the fallback to enqueue execute or reconcile", async () => {
  let allowed = true;
  const denied = new ActionContractError("Operation grant revoked", {
    errorCode: "forbidden",
    statusCode: 403,
  });
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  const unregister = register(execute, async () => {
    if (!allowed) throw denied;
  });
  const options = {
    scope,
    operation: "event",
    idempotencyKey: "operation-authority",
    input: { operation: "add" },
  };
  const { progress: queued } = await enqueueProviderWrite(options);
  const authorize = vi.fn(async () => {});
  const unregisterAuthorizer = registerProviderWriteAuthorizer(
    scope.appId,
    authorize,
  );
  disposers.push(unregisterAuthorizer);
  allowed = false;
  await expect(getProviderWrite(scope, queued.id)).rejects.toBe(denied);
  await expect(cancelQueuedProviderWrite(scope, queued.id)).rejects.toBe(
    denied,
  );
  expect(authorize).not.toHaveBeenCalled();
  unregister();
  await expect(enqueueProviderWrite(options)).rejects.toThrow(
    "handler is unavailable",
  );
  await expect(reconcileProviderWrite(scope, queued.id)).rejects.toMatchObject({
    errorCode: "provider_write_handler_unavailable",
    statusCode: 503,
  });
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "queued",
    reason: "handler_unavailable",
  });
  expect(authorize).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  unregisterAuthorizer();

  disposers.push(registerProviderWriteAuthorizer(scope.appId, authorize));
  unregisterAuthorizer();
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "queued" },
  });
  expect(authorize).toHaveBeenCalledTimes(1);
});

it("acknowledges queued enqueue before a later transient authorization failure and rechecks at dispatch", async () => {
  let checks = 0;
  const authorize = vi.fn(async () => {
    if (++checks === 2)
      throw new Error("transient authorization storage outage");
  });
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute, authorize);
  const accepted = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "accepted-before-auth-outage",
    input: { operation: "add" },
  });
  expect(accepted).toMatchObject({ progress: { status: "queued" } });
  expect(authorize).toHaveBeenCalledTimes(1);
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: accepted.progress.id,
    status: "queued",
    reason: "admission_unavailable",
  });
  expect(execute).not.toHaveBeenCalled();
  expect(
    (
      await database.query(
        "SELECT status FROM provider_write_queue WHERE id = $1",
        [accepted.progress.id],
      )
    ).rows,
  ).toEqual([{ status: "queued" }]);
  vi.setSystemTime(70_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, accepted.progress.id)).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "event-a" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("reauthorizes completed duplicate result disclosure after the enqueue conflict commits", async () => {
  let disclosing = false;
  let disclosureChecks = 0;
  const denied = new ActionContractError(
    "Access revoked before stored result disclosure",
    { errorCode: "forbidden", statusCode: 403 },
  );
  register(
    async () => ({ saved: "private-result" }),
    async () => {
      if (disclosing && ++disclosureChecks === 2) throw denied;
    },
  );
  const options = {
    scope,
    operation: "event",
    idempotencyKey: "private-completed-duplicate",
    input: { operation: "add" },
  };
  await enqueueProviderWrite(options);
  await drainProviderWrites(scope);
  disclosing = true;
  await expect(enqueueProviderWrite(options)).rejects.toBe(denied);
  expect(disclosureChecks).toBe(2);
  expect(
    (await database.query("SELECT status FROM provider_write_queue")).rows,
  ).toEqual([{ status: "completed" }]);
});

it("retains confirmed result-unavailable state while a missing handler backs off", async () => {
  const execute = vi.fn(async () => ({ saved: "x".repeat(65_536) }));
  register(execute);
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "confirmed-without-handler",
    input: { operation: "add" },
  });
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "uncertain",
    reason: "result_unavailable",
  });
  for (const dispose of disposers.splice(0)) dispose();
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "uncertain",
    reason: "result_unavailable",
    resumeAt: 70_000,
  });
  vi.setSystemTime(70_001);
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "uncertain",
    reason: "result_unavailable",
    resumeAt: 130_001,
  });
  register(execute);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "uncertain", reason: "result_unavailable" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each(["uncertain", "not_applied"] as const)(
  "backs off valid inconclusive %s reconciliation without repeating upstream reads",
  async (status) => {
    const execute = vi.fn(async () => {
      throw new Error("provider outcome unknown");
    });
    const reconcile = vi.fn(async () => ({ status }));
    register(execute, async () => {}, { replaySafe: false, reconcile });
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "inconclusive",
      input: { operation: "add" },
    });
    await drainProviderWrites(scope, { maxItems: 1 });
    expect(await reconcileProviderWrite(scope, queued.id)).toMatchObject({
      status: "uncertain",
      reason: "reconciliation_inconclusive",
      resumeAt: 70_000,
    });
    for (const time of [10_000, 20_000, 69_999]) {
      vi.setSystemTime(time);
      await reconcileProviderWrite(scope, queued.id);
      await drainProviderWrites(scope);
    }
    expect(reconcile).toHaveBeenCalledTimes(1);
    vi.setSystemTime(70_001);
    await drainProviderWrites(scope);
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it.each([null, "dispatching", "preparing"] as const)(
  "recovers an expired %s claim according to its persisted dispatch phase",
  async (claimPhase) => {
    const execute = vi.fn(async () => ({ saved: "event-a" }));
    register(execute);
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "expired-phase",
      input: { operation: "add" },
    });
    await database.query(
      "UPDATE provider_write_queue SET status = 'running', claim_id = 'dead-worker', claim_phase = $1, lease_until = 9999 WHERE id = $2",
      [claimPhase, queued.id],
    );
    await drainProviderWrites(scope, { maxItems: 1 });
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: {
        status: claimPhase === "preparing" ? "completed" : "uncertain",
      },
    });
    expect(execute).toHaveBeenCalledTimes(claimPhase === "preparing" ? 1 : 0);
    expect(
      (
        await database.query(
          "SELECT claim_phase FROM provider_write_queue WHERE id = $1",
          [queued.id],
        )
      ).rows,
    ).toEqual([{ claim_phase: null }]);
  },
);

it("fences a late preparing worker before execute after another worker recovered its expired claim", async () => {
  let blockWorker = false;
  let blocked = false;
  let announce: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    announce = resolve;
  });
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const execute = vi.fn(async () => ({ saved: "once" }));
  register(execute, async () => {
    if (blockWorker && !blocked) {
      blocked = true;
      announce();
      await barrier;
    }
  });
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "late-before-dispatch",
    input: { operation: "add" },
  });
  blockWorker = true;
  const lateWorker = drainProviderWrites(scope, { maxItems: 1 });
  const lateOutcome = lateWorker.then(
    () => undefined,
    (error: unknown) => error,
  );
  let lateError: unknown;
  try {
    await started;
    expect(
      (
        await database.query(
          "SELECT claim_phase FROM provider_write_queue WHERE id = $1",
          [queued.id],
        )
      ).rows,
    ).toEqual([{ claim_phase: "preparing" }]);
    vi.setSystemTime(130_001);
    await drainProviderWrites(scope, { maxItems: 1 });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: { status: "completed" },
      result: { saved: "once" },
    });
  } finally {
    release();
    lateError = await lateOutcome;
  }
  expect(lateError).toBeInstanceOf(Error);
  expect(lateError).toHaveProperty(
    "message",
    expect.stringContaining("claim was lost"),
  );
  expect(execute).toHaveBeenCalledTimes(1);
});

it("authorizes explicit cancellation of a poison queued head without dropping transient intents or undoing effects", async () => {
  let allowed = true;
  const denied = new ActionContractError("Access revoked", {
    errorCode: "forbidden",
    statusCode: 403,
  });
  const execute = vi.fn(async ({ operation }: z.infer<typeof inputSchema>) => {
    if (operation === "add")
      throw new Error("request builder cannot handle this intent");
    return { saved: operation };
  });
  register(
    execute,
    async () => {
      if (!allowed) throw denied;
    },
    { dispatchTracking: "provider-api" },
  );
  const { progress: poison } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "poison",
    input: { operation: "add" },
  });
  const { progress: later } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "after-poison",
    input: { operation: "move" },
  });
  await drainProviderWrites(scope);
  vi.setSystemTime(70_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, poison.id)).toMatchObject({
    progress: { status: "queued", attempts: 2 },
  });
  expect(
    await cancelQueuedProviderWrite(
      { ...scope, principalId: "other" },
      poison.id,
    ),
  ).toBeNull();
  expect(
    await cancelQueuedProviderWriteForCaller(
      { ...scope, tenantId: "other" },
      poison.id,
    ),
  ).toBeNull();
  allowed = false;
  await expect(
    cancelQueuedProviderWriteForCaller(scope, poison.id),
  ).rejects.toBe(denied);
  allowed = true;
  expect(
    await cancelQueuedProviderWriteForCaller(scope, poison.id),
  ).toMatchObject({ status: "failed", reason: "outcome_abandoned" });
  expect(await cancelQueuedProviderWrite(scope, poison.id)).toMatchObject({
    reason: "outcome_abandoned",
  });
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, later.id)).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "move" },
  });
  await expect(
    cancelQueuedProviderWrite(scope, later.id),
  ).rejects.toMatchObject({
    errorCode: "provider_write_not_queued",
    statusCode: 409,
  });
  expect(execute).toHaveBeenCalledTimes(3);
});

it("never repeats a write with an unknown outcome", async () => {
  const execute = vi.fn(async () => {
    throw new Error("response lost after provider accepted write");
  });
  register(execute);
  const { progress: queued } = await enqueueProviderWrite({
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
  const { progress: first } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "uncertain",
    input: { operation: "add" },
  });
  const { progress: second } = await enqueueProviderWrite({
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
  const { progress: queued } = await enqueueProviderWrite({
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
    const { progress: queued } = await enqueueProviderWrite({
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
    expect(execute.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(
      Array.from({ length: replaySafe ? 2 : 1 }, () => queued.id),
    );
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: { status: replaySafe ? "completed" : "uncertain" },
    });
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
  const { progress: queued } = await enqueueProviderWrite({
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

it.each([
  { replaySafe: false, value: { status: "missing" } },
  { replaySafe: true, value: { status: "missing" } },
  { replaySafe: true, value: null },
  { replaySafe: false, value: {} },
  { replaySafe: true, value: { status: "completed" } },
])(
  "retains uncertainty for invalid reconciliation output (replaySafe=$replaySafe, value=$value)",
  async ({ replaySafe, value }) => {
    const execute = vi.fn(async () => {
      throw new Error("unknown provider outcome");
    });
    const reconcile = vi.fn(async () => value);
    register(execute, async () => {}, {
      replaySafe,

      reconcile: reconcile as unknown as NonNullable<
        ProviderWriteHandler<unknown, unknown>["reconcile"]
      >,
    });
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "invalid-reconcile",
      input: { operation: "add" },
    });
    await drainProviderWrites(scope, { maxItems: 1 });
    expect(await reconcileProviderWrite(scope, queued.id)).toMatchObject({
      status: "uncertain",
      reason: "invalid_reconciliation",
      resumeAt: 70_000,
    });
    vi.setSystemTime(70_001);
    expect(await drainProviderWrites(scope)).toEqual([]);
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: { status: "uncertain", reason: "invalid_reconciliation" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
  },
);

it.each(["handler", "authorization", "read"] as const)(
  "isolates an uncertain scope's %s recovery failure across repeated small sweeps",
  async (failure) => {
    const badScope = { ...scope, connectionId: "unavailable-account" };
    const healthyScope = { ...scope, connectionId: "healthy-account" };
    let denyAuthorization = false;
    const denied = new ActionContractError("Connection access revoked", {
      errorCode: "connection_forbidden",
      statusCode: 403,
    });
    const badExecute = vi.fn(async () => {
      throw new Error("outcome unknown");
    });
    const badReconcile = vi.fn(async () => {
      if (failure === "read")
        throw new Error("provider verification unavailable");
      return { status: "uncertain" as const };
    });
    const unregisterBad = registerProviderWriteHandler(
      scope.appId,
      "unavailable-event",
      {
        policy,
        parseInput: (value) => inputSchema.parse(value),
        parseResult: (value) => outputSchema.parse(value),
        authorize: async () => {
          if (denyAuthorization) throw denied;
        },
        execute: badExecute,
        reconcile: badReconcile,
      },
    );
    disposers.push(unregisterBad);
    const { progress: bad } = await enqueueProviderWrite({
      scope: badScope,
      operation: "unavailable-event",
      idempotencyKey: "uncertain-head",
      input: { operation: "add" },
    });
    await drainProviderWrites(badScope, { maxItems: 1 });
    if (failure === "handler") unregisterBad();
    if (failure === "authorization") denyAuthorization = true;
    const healthyExecute = vi.fn(
      async ({ operation }: z.infer<typeof inputSchema>) => ({
        saved: operation,
      }),
    );
    register(healthyExecute);
    const batches: ProviderWriteScope[][] = [];
    const receipts: Awaited<ReturnType<typeof getProviderWrite>>[] = [];
    for (const [index, operation] of (["move", "delete"] as const).entries()) {
      if (index) vi.setSystemTime(70_001);
      const { progress: healthy } = await enqueueProviderWrite({
        scope: healthyScope,
        operation: "event",
        idempotencyKey: `healthy-${index}`,
        input: { operation },
      });
      const scopes = await listPendingProviderWriteScopes(scope.appId, 20);
      batches.push(scopes);

      for (const pendingScope of scopes)
        await drainProviderWrites(pendingScope, { maxItems: 1 });
      receipts.push(await getProviderWrite(healthyScope, healthy.id));
    }
    expect(batches[0]).toEqual([badScope, healthyScope]);
    expect(batches[1]).toEqual(
      expect.arrayContaining([badScope, healthyScope]),
    );
    expect(receipts).toMatchObject([
      { progress: { status: "completed" }, result: { saved: "move" } },
      { progress: { status: "completed" }, result: { saved: "delete" } },
    ]);
    const reason =
      failure === "handler"
        ? "handler_unavailable"
        : failure === "authorization"
          ? "authorization_rejected"
          : "reconciliation_unavailable";
    expect(
      (
        await database.query(
          "SELECT status, reason, resume_at FROM provider_write_queue WHERE id = $1",
          [bad.id],
        )
      ).rows,
    ).toEqual([{ status: "uncertain", reason, resume_at: 130_001 }]);
    const permissionChecks =
      failure === "authorization"
        ? [
            reconcileProviderWrite(badScope, bad.id),
            getProviderWrite(badScope, bad.id),
          ]
        : [];
    const permissionErrors = await Promise.all(
      permissionChecks.map((check) =>
        check.then(
          () => undefined,
          (error: unknown) => error,
        ),
      ),
    );
    expect(permissionErrors).toHaveLength(failure === "authorization" ? 2 : 0);
    expect(permissionErrors.every((error) => error === denied)).toBe(true);
    expect(badExecute).toHaveBeenCalledTimes(1);
    expect(healthyExecute).toHaveBeenCalledTimes(2);
    expect(badReconcile).toHaveBeenCalledTimes(failure === "read" ? 2 : 0);
  },
);

it("reauthorizes saved results and rejects a different authenticated caller", async () => {
  let allowed = true;
  const denied = new Error("grant revoked");
  const execute = vi.fn(async () => ({ saved: "private-event" }));
  register(execute, async () => {
    if (!allowed) throw denied;
  });
  const { progress: queued } = await enqueueProviderWrite({
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
  await expect(
    enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "private-result",
      input: { operation: "add" },
    }),
  ).rejects.toBe(denied);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("restores pending scheduler scopes after registration restarts and reports corrupt context", async () => {
  register(async () => ({ saved: "event-a" }));
  const { progress: queued } = await enqueueProviderWrite({
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
  const onInvalidScope = vi.fn();
  expect(
    await listPendingProviderWriteScopes(scope.appId, 20, { onInvalidScope }),
  ).toEqual([]);
  expect(onInvalidScope).toHaveBeenCalledExactlyOnceWith(
    expect.any(ProviderWriteSchedulerScopeError),
  );
  expect(onInvalidScope.mock.calls[0]?.[0]).toMatchObject({
    errorCode: "provider_write_scope_invalid",
    details: { appId: scope.appId, position: expect.any(Number) },
  });
});

it("advances past a corrupt head and dispatches healthy later scopes while reporting bounded typed errors", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  const { progress: bad } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "corrupt-head",
    input: { operation: "add" },
  });
  const healthy = { ...scope, connectionId: "healthy-account" };
  const { progress: good } = await enqueueProviderWrite({
    scope: healthy,
    operation: "event",
    idempotencyKey: "healthy-later",
    input: { operation: "move" },
  });
  const rawScope = '{"private_payload":"must-not-be-logged",';
  await database.query(
    "UPDATE provider_write_queue SET scope_json = $1 WHERE id = $2",
    [rawScope, bad.id],
  );
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await listPendingProviderWriteScopes(scope.appId, 1)).toEqual([]);
    const afterBad = (
      await database.query(
        "SELECT last_position FROM provider_write_scheduler_cursor WHERE app_id = $1",
        [scope.appId],
      )
    ).rows[0];
    const badPosition = (
      await database.query(
        "SELECT position FROM provider_write_queue WHERE id = $1",
        [bad.id],
      )
    ).rows[0];
    expect(afterBad).toEqual({ last_position: badPosition.position });
    expect(log).toHaveBeenCalledExactlyOnceWith(
      expect.any(ProviderWriteSchedulerScopeError),
    );
    const error = log.mock.calls[0]?.[0];
    expect(error).toMatchObject({
      errorCode: "provider_write_scope_invalid",
      details: { appId: scope.appId, position: badPosition.position },
    });
    expect(JSON.stringify(error)).not.toContain("must-not-be-logged");
    expect(error.cause).toBeUndefined();
    const scopes = await listPendingProviderWriteScopes(scope.appId, 1);
    expect(scopes).toEqual([healthy]);
    for (const pendingScope of scopes) await drainProviderWrites(pendingScope);
    expect(await getProviderWrite(healthy, good.id)).toMatchObject({
      progress: { status: "completed" },
    });

    expect(await listPendingProviderWriteScopes(scope.appId, 1)).toEqual([]);
    expect(log).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (
        await database.query(
          "SELECT status, scope_json FROM provider_write_queue WHERE id = $1",
          [bad.id],
        )
      ).rows,
    ).toEqual([{ status: "queued", scope_json: rawScope }]);
  } finally {
    log.mockRestore();
  }
});

it.each(["sync", "async"] as const)(
  "returns healthy scopes in the same batch even when the %s error observer and diagnostic sink fail",
  async (kind) => {
    register(async () => ({ saved: "event-a" }));
    const { progress: bad } = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "bad-observer",
      input: { operation: "add" },
    });
    const healthy = { ...scope, connectionId: "healthy-observer-account" };
    const { progress: good } = await enqueueProviderWrite({
      scope: healthy,
      operation: "event",
      idempotencyKey: "healthy-observer",
      input: { operation: "move" },
    });
    await database.query(
      "UPDATE provider_write_queue SET scope_json = 'unreadable' WHERE id = $1",
      [bad.id],
    );
    const observer = vi.fn(
      (error: InstanceType<typeof ProviderWriteSchedulerScopeError>) => {
        expect(error.errorCode).toBe("provider_write_scope_invalid");
        if (kind === "sync") throw new Error("observer failed");
        return Promise.reject(new Error("async observer failed"));
      },
    );
    const log = vi.spyOn(console, "error").mockImplementation(() => {
      throw new Error("diagnostic sink failed");
    });
    try {
      const scopes = await listPendingProviderWriteScopes(scope.appId, 20, {
        onInvalidScope: observer,
      });
      expect(scopes).toEqual([healthy]);
      for (const pendingScope of scopes)
        await drainProviderWrites(pendingScope);
      await Promise.resolve();
      expect(observer).toHaveBeenCalledTimes(1);
      expect(log).toHaveBeenCalledWith(
        expect.any(ProviderWriteSchedulerScopeError),
      );
      expect(await getProviderWrite(healthy, good.id)).toMatchObject({
        progress: { status: "completed" },
      });
    } finally {
      log.mockRestore();
    }
  },
);

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
  expect(
    await resumeProviderWriteForCaller(scope, queued[0].progress.id),
  ).toMatchObject({
    progress: { status: "queued", attempts: 0 },
  });
  expect(execute).not.toHaveBeenCalled();
  await drainProviderWrites(scope, { maxItems: 1 });
  expect(
    await resumeProviderWriteForCaller(scope, queued[0].progress.id),
  ).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "event-after-reload" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
  expect(
    await resumeProviderWriteForCaller(scope, queued[1].progress.id),
  ).toMatchObject({
    progress: { status: "queued", attempts: 0 },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("keeps an expired worker claim uncertain until its effect can be verified", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  const { progress: queued } = await enqueueProviderWrite({
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
  const { progress: queued } = await enqueueProviderWrite({
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
  const { progress: queued } = await enqueueProviderWrite({
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
  for (const time of [20_000, 40_000, 60_000]) {
    vi.setSystemTime(time);
    expect((await drainProviderWrites(scope))[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      resumeAt: 70_000,
    });
  }
  expect(
    (
      await database.query(
        "SELECT ready_at FROM provider_write_queue WHERE id = $1",
        [queued.id],
      )
    ).rows,
  ).toEqual([{ ready_at: 70_000 }]);
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
  const { progress: queued } = await enqueueProviderWrite({
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

it("retains an accepted input through incompatible rolling worker schemas and later completes the same intent", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "accepted-new-version-input",
    input: { operation: "add" },
  });
  const accepted = (
    await database.query(
      "SELECT input_json, input_hash FROM provider_write_queue WHERE id = $1",
      [queued.id],
    )
  ).rows;
  for (const dispose of disposers.splice(0)) dispose();
  disposers.push(
    registerProviderWriteHandler(scope.appId, "event", {
      policy,
      authorize: async () => {},
      parseInput: (value) => {
        const input = inputSchema.parse(value);
        if (input.operation !== "move")
          throw new TypeError("Worker version does not support this intent");
        return input;
      },
      parseResult: (value) => outputSchema.parse(value),
      execute,
    }),
  );
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "queued",
    reason: "input_incompatible",
    resumeAt: 70_000,
  });
  expect(execute).not.toHaveBeenCalled();
  expect(
    (await database.query("SELECT * FROM provider_connection_budgets")).rows,
  ).toEqual([]);
  expect(
    (
      await database.query(
        "SELECT input_json, input_hash FROM provider_write_queue WHERE id = $1",
        [queued.id],
      )
    ).rows,
  ).toEqual(accepted);
  for (const dispose of disposers.splice(0)) dispose();
  register(execute);
  vi.setSystemTime(70_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "completed", attempts: 2 },
    result: { saved: "event-a" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

const versionDriftCases = ["strip", "default", "mutate", "reorder"] as const;
const acceptedObjectSchema = z.record(z.string(), z.unknown());
function versionedInput(mode: (typeof versionDriftCases)[number]) {
  return mode === "default"
    ? { operation: "add" }
    : { operation: "add", extra: "retain", nested: { a: 1, b: 2 } };
}
function driftedInputParser(mode: (typeof versionDriftCases)[number]) {
  return (value: unknown) => {
    if (mode === "strip")
      return z.object({ operation: z.string() }).parse(value);
    if (mode === "default")
      return z
        .object({ operation: z.string(), notify: z.boolean().default(true) })
        .parse(value);
    if (mode === "mutate") {
      if (!value || typeof value !== "object")
        throw new TypeError("Expected an input object");
      Reflect.deleteProperty(value, "extra");
      return acceptedObjectSchema.parse(value);
    }
    const input = acceptedObjectSchema.parse(value);
    return {
      nested: { b: 2, a: 1 },
      extra: input.extra,
      operation: input.operation,
    };
  };
}

it.each(versionDriftCases)(
  "checks accepted JSON semantics before dispatch when a worker parser can %s fields",
  async (mode) => {
    const execute = vi.fn(async (_input: Record<string, unknown>) => ({
      saved: "event-a",
    }));
    const handler = {
      policy,
      authorize: async () => {},
      parseInput: (value: unknown) => acceptedObjectSchema.parse(value),
      parseResult: (value: unknown) => outputSchema.parse(value),
      execute,
    };
    const unregister = registerProviderWriteHandler(
      scope.appId,
      "versioned",
      handler,
    );
    disposers.push(unregister);
    const input = versionedInput(mode);
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "versioned",
      idempotencyKey: "semantic-intent",
      input,
    });
    unregister();
    const unregisterOld = registerProviderWriteHandler(
      scope.appId,
      "versioned",
      {
        ...handler,
        parseInput: driftedInputParser(mode),
      },
    );
    disposers.push(unregisterOld);
    const result = (await drainProviderWrites(scope, { maxItems: 1 }))[0];
    expect(
      (
        await database.query(
          "SELECT input_json FROM provider_write_queue WHERE id = $1",
          [queued.id],
        )
      ).rows,
    ).toEqual([{ input_json: JSON.stringify(input) }]);
    expect(result).toMatchObject(
      mode === "reorder"
        ? { status: "completed" }
        : {
            status: "queued",
            reason: "input_incompatible",
            resumeAt: 70_000,
          },
    );
    expect(execute).toHaveBeenCalledTimes(mode === "reorder" ? 1 : 0);
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual(mode === "reorder" ? [{ used: 1 }] : []);
    if (mode !== "reorder") {
      unregisterOld();
      disposers.push(
        registerProviderWriteHandler(scope.appId, "versioned", handler),
      );
      vi.setSystemTime(70_001);
      await drainProviderWrites(scope);
    }
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: { status: "completed" },
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toEqual(input);
  },
);

it.each(versionDriftCases)(
  "checks accepted JSON semantics before reconciliation when a worker parser can %s fields",
  async (mode) => {
    const execute = vi.fn(async () => {
      throw new Error("provider response lost");
    });
    const reconcile = vi.fn(async () =>
      mode === "reorder"
        ? { status: "completed" as const, result: { saved: "verified" } }
        : { status: "not_applied" as const },
    );
    const handler = {
      policy,
      replaySafe: true,
      authorize: async () => {},
      parseInput: (value: unknown) => acceptedObjectSchema.parse(value),
      parseResult: (value: unknown) => outputSchema.parse(value),
      execute,
      reconcile,
    };
    const unregister = registerProviderWriteHandler(
      scope.appId,
      "versioned",
      handler,
    );
    disposers.push(unregister);
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "versioned",
      idempotencyKey: "semantic-reconciliation",
      input: versionedInput(mode),
    });
    await drainProviderWrites(scope, { maxItems: 1 });
    unregister();
    disposers.push(
      registerProviderWriteHandler(scope.appId, "versioned", {
        ...handler,
        parseInput: driftedInputParser(mode),
      }),
    );
    const result = await reconcileProviderWrite(scope, queued.id);
    expect(result).toMatchObject(
      mode === "reorder"
        ? { status: "completed" }
        : {
            status: "uncertain",
            reason: "input_incompatible",
            resumeAt: 70_000,
          },
    );
    expect(reconcile).toHaveBeenCalledTimes(mode === "reorder" ? 1 : 0);
    if (mode !== "reorder") {
      vi.setSystemTime(70_001);
      await drainProviderWrites(scope);
    }
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress:
        mode === "reorder"
          ? { status: "completed" }
          : { status: "uncertain", reason: "input_incompatible" },
    });
    expect(reconcile).toHaveBeenCalledTimes(mode === "reorder" ? 1 : 0);
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it("spends no shared budget for repeated managed attempts rejected by an operator before HTTP", async () => {
  let paused = true;
  disposers.push(
    registerProviderBudgetGate({
      id: "managed-paused",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy,
      resolveScope: () => scope,
      readPause: async () =>
        paused
          ? { status: "paused", reason: "operator", resumeAt: null }
          : null,
    }),
  );
  const transport = vi.fn(async () => new Response("{}"));
  register(
    async () => {
      await fetchWithProviderCallGate(
        {
          providerId: scope.providerId,
          url: "https://provider.example.test/events",
          init: { method: "POST" },
        },
        transport,
      );
      return { saved: "event-a" };
    },
    async () => {},
    { dispatchTracking: "provider-api" },
  );
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "operator-no-cost",
    input: { operation: "add" },
  });
  for (const time of [10_000, 70_001, 130_002]) {
    vi.setSystemTime(time);
    expect((await drainProviderWrites(scope))[0]).toMatchObject({
      status: "queued",
      reason: "operator",
    });
    expect(
      (
        await database.query(
          "SELECT COALESCE(SUM(used), 0)::INT AS used FROM provider_connection_budgets",
        )
      ).rows,
    ).toEqual([{ used: 0 }]);
  }
  expect(transport).not.toHaveBeenCalled();
  paused = false;
  vi.setSystemTime(190_003);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "completed" },
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
});

it("admits a managed cost-two batch once within a capacity-two connection allowance", async () => {
  const batchPolicy = { capacity: 2, windowMs: 60_000 };
  disposers.push(
    registerProviderBudgetGate({
      id: "managed-batch",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: batchPolicy,
      cost: () => 2,
      resolveScope: () => scope,
      readPause: async () => null,
    }),
  );
  const transport = vi.fn(async () => new Response("{}"));
  disposers.push(
    registerProviderWriteHandler(scope.appId, "batch", {
      policy: batchPolicy,
      dispatchTracking: "provider-api",
      authorize: async () => {},
      parseInput: (value) => inputSchema.parse(value),
      parseResult: (value) => outputSchema.parse(value),
      execute: async () => {
        await fetchWithProviderCallGate(
          {
            providerId: scope.providerId,
            url: "https://provider.example.test/batch",
            init: { method: "POST" },
          },
          transport,
        );
        return { saved: "two-events" };
      },
    }),
  );
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "batch",
    idempotencyKey: "batch-two",
    input: { operation: "add" },
  });
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "two-events" },
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 2 }]);
});

it("does not charge a managed outbox reference whose existing item is already complete", async () => {
  const readOutbox = vi.fn(async () => ({
    status: "completed",
    saved: "event-a",
  }));
  register(
    async () => ({ saved: (await readOutbox()).saved }),
    async () => {},
    { dispatchTracking: "provider-api" },
  );
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "already-complete-reference",
    input: { operation: "add" },
  });
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: { status: "completed" },
    result: { saved: "event-a" },
  });
  expect(readOutbox).toHaveBeenCalledTimes(1);
  expect(
    (
      await database.query(
        "SELECT COALESCE(SUM(used), 0)::INT AS used FROM provider_connection_budgets",
      )
    ).rows,
  ).toEqual([{ used: 0 }]);
});

it("retains a managed intent after a failed preflight GET without claiming an unknown write effect", async () => {
  disposers.push(
    registerProviderBudgetGate({
      id: "managed-read",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy,
      resolveScope: () => scope,
      readPause: async () => null,
    }),
  );
  const transport = vi.fn(async () => {
    throw new Error("preflight GET unavailable");
  });
  register(
    async () => {
      await fetchWithProviderCallGate(
        {
          providerId: scope.providerId,
          url: "https://provider.example.test/event",
          init: { method: "GET" },
        },
        transport,
      );
      return { saved: "event-a" };
    },
    async () => {},
    { dispatchTracking: "provider-api" },
  );
  await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "preflight-read",
    input: { operation: "add" },
  });
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "queued",
    reason: "admission_unavailable",
    resumeAt: 70_000,
  });
  expect(transport).toHaveBeenCalledTimes(1);
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
});

it("retains an unexecuted intent through a persisted budget policy mismatch and completes it after repair", async () => {
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute);
  await reserveProviderBudget(scope, { ...policy, capacity: 2 });
  const { progress: queued } = await enqueueProviderWrite({
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
    const { progress: queued } = await enqueueProviderWrite({
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
  const { progress: queued } = await enqueueProviderWrite({
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
  const { progress: queued } = await enqueueProviderWrite({
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

it("retains an intent through an untyped authorization storage outage and completes the same ID after recovery", async () => {
  let authorized = true;
  const execute = vi.fn(async () => ({ saved: "event-a" }));
  register(execute, async () => {
    if (!authorized) throw new Error();
  });
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "untyped-authorization-failure",
    input: { operation: "add" },
  });
  authorized = false;
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "queued",
    reason: "admission_unavailable",
    resumeAt: 70_000,
  });
  vi.setSystemTime(69_999);
  expect(await drainProviderWrites(scope)).toEqual([]);
  expect(execute).not.toHaveBeenCalled();
  authorized = true;
  vi.setSystemTime(70_001);
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "completed",
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("clears an indefinite operator pause when claiming resumed work so running progress remains pollable", async () => {
  let release: () => void = () => {};
  let started: () => void = () => {};
  const running = new Promise<void>((resolve) => {
    started = resolve;
  });
  let paused = true;
  register(async () => {
    if (paused) {
      paused = false;
      throw new ProviderWriteNotDispatchedError({
        status: "paused",
        reason: "operator",
        resumeAt: null,
      });
    }
    started();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { saved: "event-a" };
  });
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "operator-resumed",
    input: { operation: "add" },
  });
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    status: "queued",
    reason: "operator",
    resumeAt: null,
  });
  vi.setSystemTime(70_001);
  const drain = drainProviderWrites(scope, { maxItems: 1 });
  try {
    await running;
    expect(await resumeProviderWriteForCaller(scope, queued.id)).toMatchObject({
      progress: {
        id: queued.id,
        status: "running",
        reason: null,
        resumeAt: null,
      },
    });
  } finally {
    release();
    await drain;
  }
});

it("keeps an oversized reconciled result uncertain and recoverable without replay or worker errors", async () => {
  const effects: string[] = [];
  const reconcile = vi.fn(async () => ({
    status: "completed" as const,
    result: { saved: "x".repeat(65_536) },
  }));
  register(
    async ({ operation }) => {
      effects.push(operation);
      if (operation === "add")
        throw new Error("effect accepted; response lost");
      return { saved: operation };
    },
    async () => {},
    {
      reconcile,
    },
  );
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "oversized-reconciliation",
    input: { operation: "add" },
  });
  const { progress: later } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "after-reconciliation",
    input: { operation: "move" },
  });
  await drainProviderWrites(scope);
  expect(await reconcileProviderWrite(scope, queued.id)).toMatchObject({
    id: queued.id,
    status: "uncertain",
    reason: "result_unavailable",
  });
  const deferred = await drainProviderWrites(scope);
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(deferred).toMatchObject([
    { status: "uncertain", reason: "result_unavailable", resumeAt: 70_000 },
  ]);
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    progress: {
      id: queued.id,
      status: "uncertain",
      reason: "result_unavailable",
    },
  });
  expect(effects).toEqual(["add"]);
  await abandonProviderWrite(scope, queued.id);
  vi.setSystemTime(11_001);
  await drainProviderWrites(scope);
  expect(await getProviderWrite(scope, later.id)).toMatchObject({
    progress: { status: "completed" },
  });
  expect(effects).toEqual(["add", "move"]);
});

it.each([
  { tracked: true, refusal: "operator" },
  { tracked: false, refusal: "operator" },
  { tracked: true, refusal: "storage" },
] as const)(
  "handles a real gate refusal before transport with tracking=$tracked and refusal=$refusal",
  async ({ tracked, refusal }) => {
    let unavailable = true;
    disposers.push(
      registerProviderBudgetGate({
        id: "queue-dispatch-test",
        matches: ({ providerId }) => providerId === scope.providerId,
        policy,
        resolveScope: () => {
          if (unavailable && refusal === "storage")
            throw new Error("scope storage unavailable");
          return scope;
        },
        readPause: async () =>
          unavailable && refusal === "operator"
            ? { status: "paused", reason: "operator", resumeAt: null }
            : null,
      }),
    );
    const transport = vi.fn(async () => new Response("{}"));
    const execute = vi.fn(async () => {
      await fetchWithProviderCallGate(
        {
          providerId: scope.providerId,
          appId: scope.appId,
          url: "https://provider.example.test/events",
          init: { method: "POST" },
        },
        transport,
      );
      return { saved: "event-a" };
    });
    register(
      execute,
      async () => {},
      tracked ? { dispatchTracking: "provider-api" } : {},
    );
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "gate-refusal",
      input: { operation: "add" },
    });
    expect((await drainProviderWrites(scope))[0]).toMatchObject({
      id: queued.id,
      status: tracked ? "queued" : "uncertain",
      reason: tracked
        ? refusal === "operator"
          ? "operator"
          : "admission_unavailable"
        : "provider_outcome_unknown",
    });
    expect(transport).not.toHaveBeenCalled();
    unavailable = false;
    vi.setSystemTime(70_001);
    await drainProviderWrites(scope);
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      progress: { status: tracked ? "completed" : "uncertain" },
    });
    expect(transport).toHaveBeenCalledTimes(tracked ? 1 : 0);
  },
);

it("keeps a tracked handler uncertain when a real provider write preceded a later gate deferral", async () => {
  disposers.push(
    registerProviderBudgetGate({
      id: "queue-dispatch-test",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy,
      resolveScope: () => scope,
      readPause: async () => null,
    }),
  );
  const transport = vi.fn(async () => new Response("{}"));
  const execute = vi.fn(async () => {
    for (const operation of ["add", "move"])
      await fetchWithProviderCallGate(
        {
          providerId: scope.providerId,
          appId: scope.appId,
          url: `https://provider.example.test/events/${operation}`,
          init: { method: "POST" },
        },
        transport,
      );
    return { saved: "event-a" };
  });
  register(execute, async () => {}, {
    dispatchTracking: "provider-api",
  });
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "effect-then-gate-refusal",
    input: { operation: "add" },
  });
  expect((await drainProviderWrites(scope))[0]).toMatchObject({
    id: queued.id,
    status: "uncertain",
    reason: "provider_outcome_unknown",
  });
  vi.setSystemTime(70_001);
  expect(await drainProviderWrites(scope)).toEqual([]);
  expect(transport).toHaveBeenCalledTimes(1);
  expect(execute).toHaveBeenCalledTimes(1);
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
    const { progress: queued } = await enqueueProviderWrite({
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
  const { progress: uncertain } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "ambiguous",
    input: { operation: "add" },
  });
  const { progress: later } = await enqueueProviderWrite({
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

  expect(
    await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "ambiguous",
      input: { operation: "add" },
    }),
  ).toMatchObject({
    progress: { status: "failed", reason: "outcome_abandoned" },
  });
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
  const { progress: write } = await enqueueProviderWrite({
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
    await expect(
      cancelQueuedProviderWrite(scope, write.id),
    ).rejects.toMatchObject({
      errorCode: "provider_write_not_queued",
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

it("retries a failed completion marker durably without replaying the accepted provider write", async () => {
  const execute = vi.fn(async () => ({ saved: "event-notified" }));
  const unregister = register(execute);
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "completion-marker-retry",
    input: { operation: "add" },
  });
  completionMarker.mockRejectedValueOnce(
    new Error("fixture marker store unavailable"),
  );
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await drainProviderWrites(scope)).toMatchObject([
      { id: queued.id, status: "completed" },
    ]);
    expect(await getProviderWrite(scope, queued.id)).toMatchObject({
      result: { saved: "event-notified" },
      notification: "pending",
    });
    expect(diagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "ProviderWriteCompletionNotificationError",
        errorCode: "provider_write_notification_unavailable",
      }),
    );
    expect(await listPendingProviderWriteScopes(scope.appId)).toEqual([scope]);
    expect(await listPendingProviderWriteScopes("another-app")).toEqual([]);
    unregister();
    let markerError: unknown;
    completionMarker.mockImplementation(async (options) => {
      const actual = await vi.importActual<
        typeof import("../server/action-change-marker-write.js")
      >("../server/action-change-marker-write.js");
      try {
        await actual.writeActionChangeMarker(options);
      } catch (error) {
        markerError = error;
        throw error;
      }
    });
    expect(await drainProviderWrites(scope)).toEqual([]);
    expect(markerError).toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(completionMarker).toHaveBeenCalledTimes(2);
    const persisted = await database.query<{
      session_id: string;
      key: string;
      value: string;
    }>("SELECT session_id, key, value FROM application_state");
    expect(persisted.rows).toHaveLength(1);
    expect(persisted.rows[0]).toMatchObject({
      session_id: scope.principalId,
      key: "__action_change__",
    });
    const persistedMarker = persisted.rows.at(0);
    if (!persistedMarker)
      throw new Error("Fixture completion marker is missing");
    expect(JSON.parse(persistedMarker.value)).toMatchObject({
      source: "action",
      actionName: `${scope.appId}:provider-write-completed`,
      owner: scope.principalId,
      requestSource: "provider-write-worker",
    });
    expect(completionMarker).toHaveBeenLastCalledWith({
      actionName: `${scope.appId}:provider-write-completed`,
      owner: scope.principalId,
      requestSource: "provider-write-worker",
    });
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual([{ used: 1 }]);
    expect(await listPendingProviderWriteScopes(scope.appId)).toEqual([]);
    expect(
      (
        await database.query(
          "SELECT completion_notified_at FROM provider_write_queue WHERE id=$1",
          [queued.id],
        )
      ).rows,
    ).toEqual([{ completion_notified_at: 10_000 }]);
  } finally {
    diagnostic.mockRestore();
  }
});

it("publishes completion after reconciliation without repeating the mutation", async () => {
  const execute = vi.fn(async () => {
    throw new Error("fixture outcome unknown");
  });
  register(execute, async () => {}, {
    reconcile: async () => ({
      status: "completed",
      result: { saved: "verified-event" },
    }),
  });
  const { progress: queued } = await enqueueProviderWrite({
    scope,
    operation: "event",
    idempotencyKey: "reconciled-completion-marker",
    input: { operation: "add" },
  });
  expect(await drainProviderWrites(scope)).toMatchObject([
    { status: "uncertain" },
  ]);
  expect(completionMarker).not.toHaveBeenCalled();
  expect(await reconcileProviderWrite(scope, queued.id)).toMatchObject({
    status: "completed",
  });
  expect(completionMarker).toHaveBeenCalledOnce();
  expect(await getProviderWrite(scope, queued.id)).toMatchObject({
    result: { saved: "verified-event" },
    notification: "published",
  });
  expect(await listPendingProviderWriteScopes(scope.appId)).toEqual([]);
  expect(execute).toHaveBeenCalledOnce();
});

it.each([false, true])(
  "parks managed writes without shared admission (pause-only gate=%s) and completes once the shared gate is registered",
  async (pauseOnly) => {
    const unregisterPauseOnly = pauseOnly
      ? registerProviderCallGate({
          id: "fixture-pause-only",
          matches: ({ providerId }) => providerId === scope.providerId,
          prepare: () => async () => {},
        })
      : undefined;
    if (unregisterPauseOnly) disposers.push(unregisterPauseOnly);
    await reserveProviderBudget(scope, policy);
    const transport = vi.fn(async () =>
      Response.json({ saved: "gate-protected" }),
    );
    register(
      async () => {
        const response = await fetchWithProviderCallGate(
          {
            providerId: scope.providerId,
            appId: scope.appId,
            url: "https://provider.example.test/events",
            init: { method: "POST" },
          },
          transport,
        );
        return response.json();
      },
      async () => {},
      { dispatchTracking: "provider-api" },
    );
    const { progress: queued } = await enqueueProviderWrite({
      scope,
      operation: "event",
      idempotencyKey: "missing-admission-gate",
      input: { operation: "add" },
    });
    expect(await drainProviderWrites(scope)).toMatchObject([
      { id: queued.id, status: "queued", reason: "admission_unavailable" },
    ]);
    expect(transport).not.toHaveBeenCalled();
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual([{ used: 1 }]);
    unregisterPauseOnly?.();
    disposers.push(
      registerProviderBudgetGate({
        id: "restored-managed-gate",
        matches: ({ providerId }) => providerId === scope.providerId,
        policy,
        resolveScope: () => scope,
        readPause: async () => null,
      }),
    );
    vi.setSystemTime(70_001);
    expect(await drainProviderWrites(scope)).toMatchObject([
      { id: queued.id, status: "completed" },
    ]);
    expect(transport).toHaveBeenCalledOnce();
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual([{ used: 1 }]);
  },
);

it("keeps semantic idempotency across nested object insertion order while preserving array order", async () => {
  const execute = vi.fn(async () => ({ saved: "semantic-intent" }));
  disposers.push(
    registerProviderWriteHandler(scope.appId, "structured-event", {
      policy,
      parseInput: (value) => value,
      parseResult: (value) => outputSchema.parse(value),
      authorize: async () => {},
      execute,
    }),
  );
  const original = {
    details: { title: "fixture", time: { hour: 10, minute: 30 } },
    attendees: [
      { name: "first", response: "accepted" },
      { name: "second", response: "tentative" },
    ],
  };
  const enqueue = (input: unknown) =>
    enqueueProviderWrite({
      scope,
      operation: "structured-event",
      idempotencyKey: "same-structured-intent",
      input,
    });
  const first = await enqueue(original);
  const reordered = {
    attendees: [
      { response: "accepted", name: "first" },
      { response: "tentative", name: "second" },
    ],
    details: { time: { minute: 30, hour: 10 }, title: "fixture" },
  };
  expect((await enqueue(reordered)).progress.id).toBe(first.progress.id);
  await drainProviderWrites(scope);
  expect(await enqueue(reordered)).toMatchObject({
    progress: { id: first.progress.id, status: "completed" },
    result: { saved: "semantic-intent" },
  });
  await expect(
    enqueue({ ...reordered, attendees: [...reordered.attendees].reverse() }),
  ).rejects.toThrow("different intent");
  expect(execute).toHaveBeenCalledOnce();
  expect(
    (
      await database.query(
        "SELECT input_json FROM provider_write_queue WHERE id=$1",
        [first.progress.id],
      )
    ).rows,
  ).toEqual([{ input_json: JSON.stringify(original) }]);
});
