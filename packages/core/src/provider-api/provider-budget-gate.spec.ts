import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

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
const {
  providerWorkStore,
  runWithProviderDispatchTracking,
  pauseProviderBudget,
  reserveProviderBudget,
} = await import("./provider-budget.js");
const { registerProviderBudgetGate } =
  await import("./provider-budget-gate.js");
const { fetchWithProviderCallGate, prepareProviderCallGate } =
  await import("./call-gates.js");
const scope = {
  providerId: "calendar-test",
  tenantId: "workspace-a",
  connectionId: "account-a",
};
const disposers: Array<() => void> = [];
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  for (const dispose of disposers.splice(0)) dispose();
  providerWorkStore.reset();
  await providerWorkStore.ready();
  await database.exec("TRUNCATE provider_connection_budgets");
});
afterAll(async () => {
  for (const dispose of disposers) dispose();
  await database.close();
});

async function reserveOneAttempt() {
  disposers.push(
    registerProviderBudgetGate({
      id: "queued-test-budget",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: { capacity: 1, windowMs: 1_000 },
      resolveScope: () => scope,
      readPause: async () => null,
    }),
  );
  const prepared = prepareProviderCallGate({
    providerId: scope.providerId,
    url: "https://provider.example.test/events",
    method: "POST",
    path: "/events",
    body: undefined,
    appId: "one",
    accountId: scope.connectionId,
    connectionId: null,
    runtime: undefined,
    deadline: Date.now() + 60_000,
    signal: undefined,
  });
  if (!prepared || !prepared.gate.recheck)
    throw new Error("Budget gate was not registered");
  const recheck = prepared.gate.recheck;
  await prepared.admit();
  return { recheck: () => recheck(prepared.request) };
}

it("rechecks a shared hold recorded after admission while the request waited for dispatch", async () => {
  const attempt = await reserveOneAttempt();
  await pauseProviderBudget(
    scope,
    { reason: "provider_throttle", resumeAt: Date.now() + 10_000 },
    { capacity: 1, windowMs: 1_000 },
  );
  await expect(attempt.recheck()).rejects.toMatchObject({
    pause: { reason: "provider_throttle" },
  });
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
});

it("does not spend an old window's admission after the replacement window is full", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(10_000);
  const attempt = await reserveOneAttempt();
  vi.setSystemTime(11_001);
  expect(
    await reserveProviderBudget(scope, { capacity: 1, windowMs: 1_000 }),
  ).toMatchObject({ status: "ready" });
  await expect(attempt.recheck()).rejects.toMatchObject({
    pause: { reason: "budget_exhausted" },
  });
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
});

it("renews an expired window once and preserves its own paid final unit on repeated dispatch checks", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(10_000);
  const attempt = await reserveOneAttempt();
  vi.setSystemTime(11_001);
  await attempt.recheck();
  await attempt.recheck();
  expect(
    (
      await database.query(
        "SELECT used, window_started_at FROM provider_connection_budgets",
      )
    ).rows,
  ).toEqual([{ used: 1, window_started_at: 11_001 }]);
});

it("charges every gated direct attempt across app runtimes and denies before transport", async () => {
  disposers.push(
    registerProviderBudgetGate({
      id: "shared-test-budget",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: { capacity: 2, windowMs: 60_000 },
      resolveScope: () => scope,
      readPause: async () => null,
    }),
  );
  const transport = vi.fn(async () => new Response("{}"));
  const input = {
    providerId: scope.providerId,
    appId: "one",
    url: "https://provider.example.test/events",
    resolveAccountId: async () => "account-a",
  };
  await fetchWithProviderCallGate(input, transport);
  await fetchWithProviderCallGate({ ...input, appId: "two" }, transport);
  await expect(
    fetchWithProviderCallGate(input, transport),
  ).rejects.toMatchObject({
    errorCode: "provider_deferred",
    statusCode: 429,
    details: { reason: "budget_exhausted" },
  });
  expect(transport).toHaveBeenCalledTimes(2);
});

it("observes a kill switch before credential-account lookup and every final dispatch", async () => {
  const readPause = vi.fn(async () => ({
    status: "paused" as const,
    reason: "operator" as const,
    resumeAt: null,
  }));
  disposers.push(
    registerProviderBudgetGate({
      id: "shared-test-budget",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: { capacity: 2, windowMs: 60_000 },
      resolveScope: () => scope,
      readPause,
    }),
  );
  const resolveAccountId = vi.fn(async () => "account-a");
  const transport = vi.fn(async () => new Response("{}"));
  await expect(
    fetchWithProviderCallGate(
      {
        providerId: scope.providerId,
        appId: "one",
        url: "https://provider.example.test/events",
        resolveAccountId,
      },
      transport,
    ),
  ).rejects.toMatchObject({
    errorCode: "provider_deferred",
    statusCode: 503,
    details: { pause: { reason: "operator", resumeAt: null } },
  });
  expect(resolveAccountId).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it("marks writes at the transport boundary while reads leave the write outcome untouched", async () => {
  disposers.push(
    registerProviderBudgetGate({
      id: "shared-test-budget",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: { capacity: 3, windowMs: 60_000 },
      resolveScope: () => scope,
      readPause: async () => null,
    }),
  );
  const tracking = { writes: 0 };
  await runWithProviderDispatchTracking(tracking, async () => {
    const input = {
      providerId: scope.providerId,
      appId: "one",
      url: "https://provider.example.test/events",
      resolveAccountId: async () => "account-a",
    };
    await fetchWithProviderCallGate(input, async () => {
      expect(tracking.writes).toBe(0);
      return Response.json({ items: [] });
    });
    await fetchWithProviderCallGate(
      { ...input, init: { method: "POST" } },
      async () => {
        expect(tracking.writes).toBe(1);
        return Response.json({ id: "created" });
      },
    );
  });
  expect(tracking.writes).toBe(1);
});

it("a last admission recheck refuses before marking any provider effect", async () => {
  let checks = 0;
  disposers.push(
    registerProviderBudgetGate({
      id: "shared-test-budget",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: { capacity: 3, windowMs: 60_000 },
      resolveScope: () => scope,
      readPause: async () =>
        ++checks === 3
          ? { status: "paused", reason: "operator", resumeAt: null }
          : null,
    }),
  );
  const tracking = { writes: 0 };
  const transport = vi.fn(async () => Response.json({ id: "created" }));
  await expect(
    runWithProviderDispatchTracking(tracking, () =>
      fetchWithProviderCallGate(
        {
          providerId: scope.providerId,
          appId: "one",
          url: "https://provider.example.test/events",
          init: { method: "POST" },
          resolveAccountId: async () => "account-a",
        },
        transport,
      ),
    ),
  ).rejects.toMatchObject({ pause: { reason: "operator" } });
  expect(tracking.writes).toBe(0);
  expect(transport).not.toHaveBeenCalled();
});
