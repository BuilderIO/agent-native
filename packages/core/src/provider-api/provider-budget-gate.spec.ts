import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";

const database = new PGlite();
const admissionDelay = vi.hoisted(() => ({
  next: undefined as
    | undefined
    | { kind: "reserve" | "recheck"; entered: () => void; wait: Promise<void> },
}));
vi.mock("../db/client.js", async () => {
  const { storeLedgerResult } =
    await import("../db/store-ledger.test-helpers.js");
  return {
    getEnclosingTransactionDbExec: () => undefined,
    getDbExec: () => ({
      execute: async (input: string | { sql: string; args?: unknown[] }) => {
        const query = typeof input === "string" ? input : input.sql;
        const ledger = storeLedgerResult(query);
        if (ledger) return ledger;
        const delay = admissionDelay.next;
        if (
          delay &&
          (delay.kind === "reserve"
            ? query.includes("INSERT INTO provider_connection_budgets") &&
              query.includes("RETURNING window_started_at")
            : query.startsWith(
                "SELECT capacity, window_ms, window_started_at, pause_reason",
              ))
        ) {
          admissionDelay.next = undefined;
          delay.entered();
          await delay.wait;
        }
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
  runWithProviderBudgetCredit,
  releaseProviderBudgetReservation,
  commitProviderBudgetReservation,
  recheckProviderBudgetReservation,
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
  admissionDelay.next = undefined;
  for (const dispose of disposers.splice(0)) dispose();
  providerWorkStore.reset();
  await providerWorkStore.ready();
  await database.exec("TRUNCATE provider_connection_budgets");
});

function holdAdmission(kind: "reserve" | "recheck") {
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  admissionDelay.next = { kind, entered, wait };
  return { started, release };
}

it.each([
  { kind: "reserve", cancellation: "deadline" },
  { kind: "recheck", cancellation: "deadline" },
  { kind: "reserve", cancellation: "abort" },
  { kind: "recheck", cancellation: "abort" },
] as const)(
  "refunds a late $kind after $cancellation without transport or leaked capacity",
  async ({ kind, cancellation }) => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(10_000);
    const policy = { capacity: 1, windowMs: 60_000 };
    disposers.push(
      registerProviderBudgetGate({
        id: "late-admission",
        matches: ({ providerId }) => providerId === scope.providerId,
        policy,
        resolveScope: () => scope,
        readPause: async () => null,
      }),
    );
    const hold = holdAdmission(kind);
    const controller = new AbortController();
    const transport = vi.fn(async () => Response.json({ id: "created" }));
    const input = {
      providerId: scope.providerId,
      appId: "one",
      url: "https://provider.example.test/events",
    };
    const pending = fetchWithProviderCallGate(
      { ...input, init: { method: "POST", signal: controller.signal } },
      transport,
    ).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    try {
      await hold.started;
      const refusal = await (async () => {
        if (cancellation === "deadline") {
          await vi.advanceTimersByTimeAsync(2_001);
          return pending;
        }
        controller.abort(new Error("caller left"));
        hold.release();
        return pending;
      })();
      hold.release();
      expect(refusal).toMatchObject({
        error:
          cancellation === "deadline"
            ? { name: "ProviderCallGateAdmissionTimeoutError" }
            : { message: "caller left" },
      });
      await expect
        .poll(
          async () =>
            (
              await database.query(
                "SELECT used FROM provider_connection_budgets",
              )
            ).rows[0]?.used,
        )
        .toBe(0);
      expect(transport).not.toHaveBeenCalled();
      await fetchWithProviderCallGate(
        { ...input, init: { method: "POST" } },
        transport,
      );
      expect(transport).toHaveBeenCalledTimes(1);
      expect(
        (await database.query("SELECT used FROM provider_connection_budgets"))
          .rows,
      ).toEqual([{ used: 1 }]);
    } finally {
      hold.release();
    }
  },
);

it("refunds transferred aliases once and invalidates every refunded credit", async () => {
  const policy = { capacity: 3, windowMs: 60_000 };
  const original = await reserveProviderBudget(scope, policy);
  if (original.status !== "ready")
    throw new Error("Fixture reservation refused");
  const alias = await runWithProviderBudgetCredit(
    scope,
    policy,
    1,
    original,
    () => reserveProviderBudget(scope, policy),
  );
  if (alias.status !== "ready") throw new Error("Fixture credit refused");
  await reserveProviderBudget(scope, policy);
  await Promise.all([
    releaseProviderBudgetReservation(original),
    releaseProviderBudgetReservation(alias),
    releaseProviderBudgetReservation(original),
  ]);
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
  expect(() =>
    runWithProviderBudgetCredit(scope, policy, 1, alias, async () => {}),
  ).toThrow("original budget reservation");
  await expect(
    recheckProviderBudgetReservation(scope, policy, 1, original),
  ).rejects.toThrow("original budget reservation");
});

it("never refunds another window or a reservation already spent by dispatch", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(10_000);
  const policy = { capacity: 2, windowMs: 1_000 };
  const old = await reserveProviderBudget(scope, policy);
  if (old.status !== "ready") throw new Error("Fixture reservation refused");
  vi.setSystemTime(11_001);
  const current = await reserveProviderBudget(scope, policy);
  if (current.status !== "ready")
    throw new Error("Fixture reservation refused");
  await releaseProviderBudgetReservation(old);
  expect(
    (
      await database.query(
        "SELECT used, window_started_at FROM provider_connection_budgets",
      )
    ).rows,
  ).toEqual([{ used: 1, window_started_at: 11_001 }]);
  commitProviderBudgetReservation(current);
  await releaseProviderBudgetReservation(current);
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([{ used: 1 }]);
});

it("refuses an expired admission before resolving scope or spending capacity", async () => {
  const resolveScope = vi.fn(() => scope);
  disposers.push(
    registerProviderBudgetGate({
      id: "already-expired",
      matches: ({ providerId }) => providerId === scope.providerId,
      policy: { capacity: 1, windowMs: 60_000 },
      resolveScope,
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
    deadline: Date.now() - 1,
    signal: undefined,
  });
  if (!prepared) throw new Error("Gate was not registered");
  await expect(prepared.admit()).rejects.toMatchObject({
    name: "ProviderCallGateAdmissionTimeoutError",
  });
  expect(resolveScope).not.toHaveBeenCalled();
  expect(
    (await database.query("SELECT used FROM provider_connection_budgets")).rows,
  ).toEqual([]);
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
