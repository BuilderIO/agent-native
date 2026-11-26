import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

const database = new PGlite();
const databaseFault = vi.hoisted(() => ({ unavailable: false }));
vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
    getEnclosingTransactionDbExec: () => undefined,
    getDbExec: () => ({
      execute: async (input: string | { sql: string; args?: unknown[] }) => {
        if (databaseFault.unavailable) throw new Error("database unavailable");
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
const {
  reserveProviderBudget,
  pauseProviderBudget,
  readWithProviderBudget,
  providerWorkStore,
  ProviderDeferredError,
  providerConnectionKey,
  runWithProviderBudgetCredit,
  recheckProviderBudgetReservation,
} = await import("./provider-budget.js");
const { runWithProviderDispatchTracking, noteProviderWriteDispatch } =
  await import("./provider-dispatch.js");
const { registerProviderBudgetGate } =
  await import("./provider-budget-gate.js");
const { fetchWithProviderCallGate } = await import("./call-gates.js");
const scope = {
  providerId: "calendar",
  tenantId: "workspace-a",
  connectionId: "account-a",
};
const policy = { capacity: 2, windowMs: 1_000 };
beforeEach(async () => {
  databaseFault.unavailable = false;
  providerWorkStore.reset();
  await providerWorkStore.ready();
  await database.exec(
    "TRUNCATE provider_connection_budgets, provider_read_cache, provider_write_queue",
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(10_000);
});
afterAll(async () => {
  vi.useRealTimers();
  await database.close();
});

it("atomically shares one allowance across simultaneous callers and resumes after the window", async () => {
  const results = await Promise.all(
    Array.from({ length: 8 }, () => reserveProviderBudget(scope, policy)),
  );
  expect(results.filter((result) => result.status === "ready")).toHaveLength(2);
  expect(results.filter((result) => result.status === "paused")).toHaveLength(
    6,
  );
  vi.setSystemTime(11_001);
  expect(await reserveProviderBudget(scope, policy)).toMatchObject({
    status: "ready",
  });
  expect(
    await reserveProviderBudget({ ...scope, connectionId: "other" }, policy),
  ).toMatchObject({ status: "ready" });
});

it("returns cached data with a typed stale state and never invents an empty on a cold pause", async () => {
  const execute = vi.fn(async () => ["event-a"]);
  expect(
    await readWithProviderBudget({
      scope,
      policy,
      principalId: "reader-a",
      authorize: async () => {},
      cacheKey: "week",
      parse: (value: unknown) => value,
      execute,
    }),
  ).toMatchObject({ status: "fresh", data: ["event-a"] });
  await pauseProviderBudget(
    scope,
    {
      reason: "provider_throttle",
      resumeAt: 20_000,
    },
    policy,
  );
  expect(
    await readWithProviderBudget({
      scope,
      policy,
      principalId: "reader-a",
      authorize: async () => {},
      cacheKey: "week",
      parse: (value: unknown) => value,
      execute,
    }),
  ).toMatchObject({
    status: "stale",
    data: ["event-a"],
    pause: { reason: "provider_throttle", resumeAt: 20_000 },
  });
  expect(
    await readWithProviderBudget({
      scope,
      policy,
      principalId: "reader-a",
      authorize: async () => {},
      cacheKey: "uncached",
      parse: (value: unknown) => value,
      execute,
    }),
  ).toMatchObject({
    status: "unavailable",
    pause: { reason: "provider_throttle" },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("keeps a kill switch distinct and does not auto-clear an indefinite pause", async () => {
  await pauseProviderBudget(
    scope,
    { reason: "operator", resumeAt: null },
    policy,
  );
  vi.setSystemTime(99_000);
  expect(await reserveProviderBudget(scope, policy)).toMatchObject({
    status: "paused",
    reason: "operator",
    resumeAt: null,
  });
});

it.each(
  (
    ["provider_throttle", "budget_exhausted", "admission_unavailable"] as const
  ).flatMap((reason) =>
    [null, Number.NaN, Number.POSITIVE_INFINITY].map((resumeAt) => ({
      reason,
      resumeAt,
    })),
  ),
)(
  "rejects an invalid timed pause $reason/$resumeAt before storing a budget hold",
  async (pause) => {
    await expect(pauseProviderBudget(scope, pause, policy)).rejects.toThrow(
      "resume time",
    );
    expect(
      () => new ProviderDeferredError({ status: "paused", ...pause }),
    ).toThrow("resume time");
    expect(
      (await database.query("SELECT * FROM provider_connection_budgets")).rows,
    ).toEqual([]);
    expect(await reserveProviderBudget(scope, policy)).toEqual({
      status: "ready",
    });
  },
);

it("preserves the operator's indefinite hold when an invalid throttle is rejected", async () => {
  await pauseProviderBudget(
    scope,
    { reason: "operator", resumeAt: null },
    policy,
  );
  await expect(
    pauseProviderBudget(
      scope,
      {
        reason: "provider_throttle",
        resumeAt: null,
      },
      policy,
    ),
  ).rejects.toThrow("resume time");
  expect(await reserveProviderBudget(scope, policy)).toEqual({
    status: "paused",
    reason: "operator",
    resumeAt: null,
  });
});

it("does not poison the shared budget when a read receives a malformed throttle", async () => {
  const error = new ProviderDeferredError({
    status: "paused",
    reason: "provider_throttle",
    resumeAt: 20_000,
  });
  error.pause.resumeAt = null;
  let malformed = true;
  const options = {
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "week",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => {
      if (malformed) throw error;
      return ["event-a"];
    },
  };
  await expect(readWithProviderBudget(options)).rejects.toThrow("resume time");
  expect(
    (
      await database.query(
        "SELECT pause_reason FROM provider_connection_budgets",
      )
    ).rows,
  ).toEqual([{ pause_reason: null }]);
  malformed = false;
  expect(await readWithProviderBudget(options)).toMatchObject({
    status: "fresh",
    data: ["event-a"],
  });
});

it("tracks actual write dispatches without charging GET/HEAD or leaking across handlers", async () => {
  const first = { writes: 0 };
  const second = { writes: 0 };
  await Promise.all([
    runWithProviderDispatchTracking(first, async () => {
      noteProviderWriteDispatch("GET");
      noteProviderWriteDispatch("head");
      await Promise.resolve();
      noteProviderWriteDispatch("POST");
      noteProviderWriteDispatch("PATCH");
    }),
    runWithProviderDispatchTracking(second, async () => {
      await Promise.resolve();
      noteProviderWriteDispatch("DELETE");
    }),
  ]);
  noteProviderWriteDispatch("POST");
  expect(first.writes).toBe(2);
  expect(second.writes).toBe(1);
});

it("tracks nested write effects in both the enclosing and inner handler", async () => {
  const outer = { writes: 0 };
  const inner = { writes: 0 };
  await runWithProviderDispatchTracking(outer, async () => {
    noteProviderWriteDispatch("POST");
    await runWithProviderDispatchTracking(inner, async () => {
      noteProviderWriteDispatch("PUT");
    });
  });
  expect(outer.writes).toBe(2);
  expect(inner.writes).toBe(1);
});

it.each([
  ["operator", null, false],
  ["operator", null, true],
  ["admission_unavailable", 70_000, false],
  ["admission_unavailable", 70_000, true],
] as const)(
  "rechecks live %s state after it clears (resumeAt: %s, cached: %s)",
  async (reason, resumeAt, cached) => {
    let held = false;
    const execute = vi.fn(async () => {
      if (held)
        throw new ProviderDeferredError({ status: "paused", reason, resumeAt });
      return ["event-a"];
    });
    const options = {
      scope,
      policy: { capacity: 10, windowMs: 60_000 },
      principalId: "reader-a",
      cacheKey: "live-gate",
      authorize: async () => {},
      parse: (value: unknown) => value,
      execute,
    };
    if (cached) await readWithProviderBudget(options);
    held = true;
    expect(await readWithProviderBudget(options)).toMatchObject({
      status: cached ? "stale" : "unavailable",
      pause: { status: "paused", reason, resumeAt },
      ...(cached ? { data: ["event-a"] } : {}),
    });
    expect(
      (
        await database.query(
          "SELECT pause_reason FROM provider_connection_budgets",
        )
      ).rows,
    ).toEqual([{ pause_reason: null }]);
    held = false;
    expect(await readWithProviderBudget(options)).toMatchObject({
      status: "fresh",
      data: ["event-a"],
    });
    expect(execute).toHaveBeenCalledTimes(cached ? 3 : 2);
  },
);

it("shares a provider throttle observed during execution with subsequent callers", async () => {
  const execute = vi.fn(async () => {
    throw new ProviderDeferredError({
      status: "paused",
      reason: "provider_throttle",
      resumeAt: 20_000,
    });
  });
  const options = {
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "throttled-read",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute,
  };
  await readWithProviderBudget(options);
  expect(await readWithProviderBudget(options)).toMatchObject({
    status: "unavailable",
    pause: { reason: "provider_throttle", resumeAt: 20_000 },
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("preserves foreground headroom while all caller classes spend the same counter", async () => {
  const mailPolicy = { capacity: 150, windowMs: 60_000 };
  for (let index = 0; index < 40; index++)
    expect(
      await reserveProviderBudget(scope, mailPolicy, 1, { ceiling: 40 }),
    ).toEqual({ status: "ready" });
  expect(
    await reserveProviderBudget(scope, mailPolicy, 1, { ceiling: 40 }),
  ).toMatchObject({ status: "paused" });
  expect(await reserveProviderBudget(scope, mailPolicy, 110)).toEqual({
    status: "ready",
  });
  expect(await reserveProviderBudget(scope, mailPolicy)).toMatchObject({
    status: "paused",
  });
});

it("reauthorizes cached reads and keeps another reader's cache isolated", async () => {
  let allowed = true;
  const denied = new Error("connection access was revoked");
  const execute = vi.fn(async () => ["private-event"]);
  const options = {
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "week",
    authorize: async () => {
      if (!allowed) throw denied;
    },
    parse: (value: unknown) => value,
    execute,
  };
  await readWithProviderBudget(options);
  await pauseProviderBudget(
    scope,
    { reason: "provider_throttle", resumeAt: 20_000 },
    policy,
  );
  expect(
    await readWithProviderBudget({ ...options, principalId: "reader-b" }),
  ).toMatchObject({ status: "unavailable" });
  allowed = false;
  await expect(readWithProviderBudget(options)).rejects.toBe(denied);
  expect(execute).toHaveBeenCalledTimes(1);
});

it("returns a typed storage failure instead of pretending the budget is paused or clear", async () => {
  databaseFault.unavailable = true;
  await expect(reserveProviderBudget(scope, policy)).rejects.toMatchObject({
    errorCode: "provider_budget_unavailable",
    statusCode: 503,
  });
});

it("rejects an unknown persisted pause reason rather than returning an ordinary pause", async () => {
  await pauseProviderBudget(
    scope,
    { reason: "provider_throttle", resumeAt: 20_000 },
    policy,
  );
  await database.exec(
    "UPDATE provider_connection_budgets SET pause_reason = 'corrupt_state'",
  );
  await expect(reserveProviderBudget(scope, policy)).rejects.toThrow(
    "Unreadable provider pause reason",
  );
});

it("does not store oversized provider results or invent a cached value later", async () => {
  const execute = vi.fn(async () => "x".repeat(65_536));
  const options = {
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "query",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute,
  };
  expect(await readWithProviderBudget(options)).toMatchObject({
    status: "fresh",
    cache: "payload_too_large",
  });
  await pauseProviderBudget(
    scope,
    { reason: "provider_throttle", resumeAt: 20_000 },
    policy,
  );
  expect(await readWithProviderBudget(options)).toMatchObject({
    status: "unavailable",
  });
  expect(execute).toHaveBeenCalledTimes(1);
});

it("expires cached responses after thirty days without reporting expired data as stale", async () => {
  const options = {
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "week",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: vi.fn(async () => ["old-event"]),
  };
  await readWithProviderBudget(options);
  await database.query("UPDATE provider_read_cache SET fetched_at = $1", [
    10_000 - 30 * 24 * 60 * 60_000,
  ]);
  await pauseProviderBudget(
    scope,
    { reason: "operator", resumeAt: null },
    policy,
  );
  expect(await readWithProviderBudget(options)).toEqual({
    status: "unavailable",
    pause: { status: "paused", reason: "operator", resumeAt: null },
  });
  expect(options.execute).toHaveBeenCalledTimes(1);
});

it("prunes expired and excess connection cache keys while preserving the fresh result and other connections", async () => {
  const key = providerConnectionKey(scope);
  await database.query(
    `INSERT INTO provider_read_cache (scope_key, cache_key, data_json, fetched_at)
      SELECT $1, 'old-' || i, '"recent"', $2 + i FROM generate_series(0, 127) i`,
    [key, 9_000],
  );
  await database.query(
    `INSERT INTO provider_read_cache (scope_key, cache_key, data_json, fetched_at)
      VALUES ($1, 'expired', '"expired"', $2), ('other-connection', 'keep', '"other"', 1)`,
    [key, 10_000 - 30 * 24 * 60 * 60_000],
  );
  const options = {
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "fresh-query",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => ["fresh-event"],
  };
  expect(await readWithProviderBudget(options)).toMatchObject({
    status: "fresh",
    data: ["fresh-event"],
  });
  expect(
    (
      await database.query(
        "SELECT cache_key FROM provider_read_cache WHERE scope_key = $1 ORDER BY cache_key",
        [key],
      )
    ).rows,
  ).toHaveLength(128);
  expect(
    (
      await database.query(
        "SELECT cache_key FROM provider_read_cache WHERE cache_key IN ('expired', 'old-0')",
      )
    ).rows,
  ).toEqual([]);
  expect(
    (
      await database.query(
        "SELECT data_json FROM provider_read_cache WHERE scope_key = 'other-connection'",
      )
    ).rows,
  ).toEqual([{ data_json: '"other"' }]);
  await pauseProviderBudget(
    scope,
    { reason: "operator", resumeAt: null },
    policy,
  );
  expect(await readWithProviderBudget(options)).toMatchObject({
    status: "stale",
    data: ["fresh-event"],
  });
});

it("retains the just-fetched key when all connection readers have the same timestamp", async () => {
  const key = providerConnectionKey(scope);
  await database.query(
    `INSERT INTO provider_read_cache (scope_key, cache_key, data_json, fetched_at)
      SELECT $1, 'z-' || i, '"other-reader"', 10000 FROM generate_series(0, 127) i`,
    [key],
  );
  const options = {
    scope,
    policy,
    principalId: "reader-b",
    cacheKey: "fresh-query",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => ["fresh-event"],
  };
  await readWithProviderBudget(options);
  expect(
    (
      await database.query(
        "SELECT cache_key FROM provider_read_cache WHERE scope_key = $1",
        [key],
      )
    ).rows,
  ).toHaveLength(128);
  await pauseProviderBudget(
    scope,
    { reason: "operator", resumeAt: null },
    policy,
  );
  expect(await readWithProviderBudget(options)).toMatchObject({
    status: "stale",
    data: ["fresh-event"],
  });
});

it("bounds each historical cache cleanup batch while retaining the new result", async () => {
  const key = providerConnectionKey(scope);
  await database.query(
    `INSERT INTO provider_read_cache (scope_key, cache_key, data_json, fetched_at)
      SELECT $1, 'overflow-' || i, '"old"', 1 FROM generate_series(0, 399) i`,
    [key],
  );
  await readWithProviderBudget({
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "fresh-query",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => ["fresh-event"],
  });
  expect(
    (
      await database.query(
        "SELECT cache_key FROM provider_read_cache WHERE scope_key = $1",
        [key],
      )
    ).rows,
  ).toHaveLength(273);
  expect(
    (
      await database.query(
        "SELECT data_json FROM provider_read_cache WHERE data_json = $1",
        ['["fresh-event"]'],
      )
    ).rows,
  ).toEqual([{ data_json: '["fresh-event"]' }]);
});

it("rejects unreadable cached JSON rather than reporting an empty result", async () => {
  const options = {
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "week",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => ["event-a"],
  };
  await readWithProviderBudget(options);
  await pauseProviderBudget(
    scope,
    { reason: "provider_throttle", resumeAt: 20_000 },
    policy,
  );
  await database.exec("UPDATE provider_read_cache SET data_json = '{'");
  await expect(readWithProviderBudget(options)).rejects.toBeInstanceOf(
    SyntaxError,
  );
});

it("charges a budgeted read's nested transport once and never lends its credit to a second call", async () => {
  const singleRequestPolicy = { capacity: 1, windowMs: 60_000 };
  const admissions: string[] = [];
  const result = await readWithProviderBudget({
    scope,
    policy: singleRequestPolicy,
    principalId: "reader-a",
    cacheKey: "gated-read",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => {
      admissions.push(
        (await reserveProviderBudget(scope, singleRequestPolicy)).status,
      );
      admissions.push(
        (await reserveProviderBudget(scope, singleRequestPolicy)).status,
      );
      return ["event-a"];
    },
  });
  expect(result).toMatchObject({ status: "fresh", data: ["event-a"] });
  expect(admissions).toEqual(["ready", "paused"]);
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
  expect(await reserveProviderBudget(scope, singleRequestPolicy)).toMatchObject(
    { status: "paused" },
  );
});

it("honors a shared pause persisted after reservation but before its nested transport", async () => {
  const transport = vi.fn(async () => ["event-a"]);
  const result = await readWithProviderBudget({
    scope,
    policy,
    principalId: "reader-a",
    cacheKey: "late-pause",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => {
      await pauseProviderBudget(
        scope,
        { reason: "provider_throttle", resumeAt: 20_000 },
        policy,
      );
      const nested = await reserveProviderBudget(scope, policy);
      if (nested.status === "paused") throw new ProviderDeferredError(nested);
      return transport();
    },
  });
  expect(result).toEqual({
    status: "unavailable",
    pause: { status: "paused", reason: "provider_throttle", resumeAt: 20_000 },
  });
  expect(transport).not.toHaveBeenCalled();
});

it("does not spend an old prepaid reservation against a full replacement budget window", async () => {
  const single = { capacity: 1, windowMs: 1_000 };
  const transport = vi.fn(async () => ["event-a"]);
  const result = await readWithProviderBudget({
    scope,
    policy: single,
    principalId: "reader-a",
    cacheKey: "old-window",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => {
      vi.setSystemTime(11_001);

      await database.query(
        "UPDATE provider_connection_budgets SET window_started_at = $1, used = 1",
        [11_001],
      );
      const nested = await reserveProviderBudget(scope, single);
      if (nested.status === "paused") throw new ProviderDeferredError(nested);
      return transport();
    },
  });
  expect(result).toEqual({
    status: "unavailable",
    pause: { status: "paused", reason: "budget_exhausted", resumeAt: 12_001 },
  });
  expect(transport).not.toHaveBeenCalled();
});

it("reserves again when prepaid work crosses into an available new window", async () => {
  const single = { capacity: 1, windowMs: 1_000 };
  await readWithProviderBudget({
    scope,
    policy: single,
    principalId: "reader-a",
    cacheKey: "expired-credit",
    authorize: async () => {},
    parse: (value: unknown) => value,
    execute: async () => {
      vi.setSystemTime(11_001);
      expect(await reserveProviderBudget(scope, single)).toEqual({
        status: "ready",
      });
      return ["event-a"];
    },
  });
  expect(
    (
      await database.query(
        "SELECT window_started_at, used FROM provider_connection_budgets",
      )
    ).rows,
  ).toEqual([{ window_started_at: 11_001, used: 1 }]);
});

it("rechecks a changed stored policy before lending a prepaid reservation", async () => {
  const transport = vi.fn(async () => ["event-a"]);
  await expect(
    readWithProviderBudget({
      scope,
      policy,
      principalId: "reader-a",
      cacheKey: "changed-policy",
      authorize: async () => {},
      parse: (value: unknown) => value,
      execute: async () => {
        await database.query(
          "UPDATE provider_connection_budgets SET capacity = $1",
          [policy.capacity + 1],
        );
        await reserveProviderBudget(scope, policy);
        return transport();
      },
    }),
  ).rejects.toThrow("Conflicting policies");
  expect(transport).not.toHaveBeenCalled();
});

it("cannot lend one verified reservation through two credit wrappers or forge one from ready status", async () => {
  const single = { capacity: 1, windowMs: 1_000 };
  const admission = await reserveProviderBudget(scope, single);
  if (admission.status !== "ready")
    throw new Error("Fixture reservation was refused.");
  expect(
    await runWithProviderBudgetCredit(scope, single, 1, admission, () =>
      reserveProviderBudget(scope, single),
    ),
  ).toEqual({ status: "ready" });
  expect(
    await runWithProviderBudgetCredit(scope, single, 1, admission, () =>
      reserveProviderBudget(scope, single),
    ),
  ).toMatchObject({ status: "paused", reason: "budget_exhausted" });
  expect(() =>
    runWithProviderBudgetCredit(scope, single, 1, { status: "ready" }, () =>
      reserveProviderBudget(scope, single),
    ),
  ).toThrow("original budget reservation");
});

it("rechecks a consumed transport receipt without charging its last paid unit again", async () => {
  const single = { capacity: 1, windowMs: 1_000 };
  const original = await reserveProviderBudget(scope, single);
  if (original.status !== "ready")
    throw new Error("Fixture reservation was refused.");
  const transportReceipt = await runWithProviderBudgetCredit(
    scope,
    single,
    1,
    original,
    () => reserveProviderBudget(scope, single),
  );
  if (transportReceipt.status !== "ready")
    throw new Error("Fixture transport was refused.");
  expect(
    await recheckProviderBudgetReservation(scope, single, 1, original),
  ).toEqual({ status: "ready" });
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
  await pauseProviderBudget(
    scope,
    { reason: "provider_throttle", resumeAt: 20_000 },
    single,
  );
  expect(
    await recheckProviderBudgetReservation(scope, single, 1, transportReceipt),
  ).toEqual({
    status: "paused",
    reason: "provider_throttle",
    resumeAt: 20_000,
  });
  await expect(
    recheckProviderBudgetReservation(
      { ...scope, connectionId: "other" },
      single,
      1,
      transportReceipt,
    ),
  ).rejects.toThrow("original budget reservation");
  await expect(
    recheckProviderBudgetReservation(scope, single, 1, { status: "ready" }),
  ).rejects.toThrow("original budget reservation");
});

it.each([1, 2])(
  "composes queue credit, budgeted reads, and actual gates into exactly %s paid HTTP requests",
  async (requests) => {
    const composedPolicy = { capacity: requests, windowMs: 60_000 };
    const dispose = registerProviderBudgetGate({
      id: "composed-credit-test",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: composedPolicy,
      resolveScope: () => scope,
      readPause: async () => null,
    });
    const transport = vi.fn(async () => new Response('["event-a"]'));
    try {
      const original = await reserveProviderBudget(scope, composedPolicy);
      if (original.status !== "ready")
        throw new Error("Fixture reservation was refused.");
      const results = await runWithProviderBudgetCredit(
        scope,
        composedPolicy,
        1,
        original,
        () =>
          Promise.all(
            Array.from({ length: requests }, (_, index) =>
              readWithProviderBudget({
                scope,
                policy: composedPolicy,
                principalId: "reader-a",
                cacheKey: `composition-${index}`,
                authorize: async () => {},
                parse: (value: unknown) => value,
                execute: async () => {
                  const response = await fetchWithProviderCallGate(
                    {
                      providerId: scope.providerId,
                      appId: "calendar-test",
                      url: "https://provider.example.test/events",
                      init: { method: "GET" },
                    },
                    transport,
                  );
                  return response.json();
                },
              }),
            ),
          ),
      );
      expect(results).toEqual(
        Array.from({ length: requests }, () =>
          expect.objectContaining({ status: "fresh", data: ["event-a"] }),
        ),
      );
      expect(transport).toHaveBeenCalledTimes(requests);
      expect(
        (await database.query("SELECT used FROM provider_connection_budgets"))
          .rows,
      ).toEqual([{ used: requests }]);
      expect(await reserveProviderBudget(scope, composedPolicy)).toMatchObject({
        status: "paused",
        reason: "budget_exhausted",
      });
    } finally {
      dispose();
    }
  },
);

it("charges a configured two-unit read once through its actual transport gate", async () => {
  const weighted = { capacity: 3, windowMs: 60_000 };
  const dispose = registerProviderBudgetGate({
    id: "weighted-read-test",
    matches: ({ providerId }) => providerId === scope.providerId,
    policy: weighted,
    cost: () => 2,
    resolveScope: () => scope,
    readPause: async () => null,
  });
  const transport = vi.fn(async () => new Response('["event-a"]'));
  try {
    const result = await readWithProviderBudget({
      scope,
      policy: weighted,
      cost: 2,
      principalId: "reader-a",
      cacheKey: "weighted",
      authorize: async () => {},
      parse: (value: unknown) => value,
      execute: async () =>
        (
          await fetchWithProviderCallGate(
            {
              providerId: scope.providerId,
              appId: "calendar-test",
              url: "https://provider.example.test/events",
            },
            transport,
          )
        ).json(),
    });
    expect(result).toMatchObject({ status: "fresh", data: ["event-a"] });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual([{ used: 2 }]);
  } finally {
    dispose();
  }
});

it("does not turn a refused high-cost request into a global pause for affordable requests", async () => {
  const weighted = { capacity: 3, windowMs: 60_000 };
  const dispose = registerProviderBudgetGate({
    id: "weighted-read-test",
    matches: ({ providerId }) => providerId === scope.providerId,
    policy: weighted,
    cost: (request) => (request.url.endsWith("/expensive") ? 3 : 1),
    resolveScope: () => scope,
    readPause: async () => null,
  });
  const transport = vi.fn(async () => new Response('["event-a"]'));
  const request = (path: string) =>
    fetchWithProviderCallGate(
      {
        providerId: scope.providerId,
        appId: "calendar-test",
        url: `https://provider.example.test/${path}`,
      },
      transport,
    );
  try {
    expect(
      await readWithProviderBudget({
        scope,
        policy: weighted,
        principalId: "reader-a",
        cacheKey: "two-requests",
        authorize: async () => {},
        parse: (value: unknown) => value,
        execute: async () => {
          await request("cheap");
          return (await request("expensive")).json();
        },
      }),
    ).toMatchObject({
      status: "unavailable",
      pause: { reason: "budget_exhausted" },
    });
    expect(
      (
        await database.query(
          "SELECT used, pause_reason FROM provider_connection_budgets",
        )
      ).rows,
    ).toEqual([{ used: 1, pause_reason: null }]);
    expect(await request("cheap")).toBeInstanceOf(Response);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual([{ used: 2 }]);
  } finally {
    dispose();
  }
});

it("rejects a mismatched first transport cost explicitly before a second debit or dispatch", async () => {
  const weighted = { capacity: 5, windowMs: 60_000 };
  const dispose = registerProviderBudgetGate({
    id: "weighted-read-test",
    matches: ({ providerId }) => providerId === scope.providerId,
    policy: weighted,
    cost: () => 2,
    resolveScope: () => scope,
    readPause: async () => null,
  });
  const transport = vi.fn(async () => new Response('["event-a"]'));
  try {
    await expect(
      readWithProviderBudget({
        scope,
        policy: weighted,
        principalId: "reader-a",
        cacheKey: "misconfigured",
        authorize: async () => {},
        parse: (value: unknown) => value,
        execute: async () =>
          (
            await fetchWithProviderCallGate(
              {
                providerId: scope.providerId,
                appId: "calendar-test",
                url: "https://provider.example.test/events",
              },
              transport,
            )
          ).json(),
      }),
    ).rejects.toMatchObject({
      errorCode: "provider_budget_credit_mismatch",
      statusCode: 503,
    });
    expect(transport).not.toHaveBeenCalled();
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual([{ used: 1 }]);
  } finally {
    dispose();
  }
});

it("lets managed reads charge actual weighted requests without adding a helper reservation", async () => {
  const weighted = { capacity: 4, windowMs: 60_000 };
  const dispose = registerProviderBudgetGate({
    id: "weighted-read-test",
    matches: ({ providerId }) => providerId === scope.providerId,
    policy: weighted,
    cost: () => 2,
    resolveScope: () => scope,
    readPause: async () => null,
  });
  const transport = vi.fn(async () => new Response('["event-a"]'));
  try {
    const result = await readWithProviderBudget({
      scope,
      policy: weighted,
      dispatchTracking: "provider-api",
      principalId: "reader-a",
      cacheKey: "two-pages",
      authorize: async () => {},
      parse: (value: unknown) => value,
      execute: async () => {
        const pages = [];
        for (let index = 0; index < 2; index++)
          pages.push(
            await (
              await fetchWithProviderCallGate(
                {
                  providerId: scope.providerId,
                  appId: "calendar-test",
                  url: `https://provider.example.test/events/${index}`,
                },
                transport,
              )
            ).json(),
          );
        return pages;
      },
    });
    expect(result).toMatchObject({
      status: "fresh",
      data: [["event-a"], ["event-a"]],
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(
      (await database.query("SELECT used FROM provider_connection_budgets"))
        .rows,
    ).toEqual([{ used: 4 }]);
  } finally {
    dispose();
  }
});
