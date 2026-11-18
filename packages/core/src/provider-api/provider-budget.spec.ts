import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

const database = new PGlite();
const databaseFault = vi.hoisted(() => ({ unavailable: false }));
vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
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
} = await import("./provider-budget.js");
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
