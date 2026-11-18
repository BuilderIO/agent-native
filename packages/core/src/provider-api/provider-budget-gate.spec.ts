import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeEach, expect, it, vi } from "vitest";

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
const { providerWorkStore } = await import("./provider-budget.js");
const { registerProviderBudgetGate } =
  await import("./provider-budget-gate.js");
const { fetchWithProviderCallGate } = await import("./call-gates.js");
const scope = {
  providerId: "calendar-test",
  tenantId: "workspace-a",
  connectionId: "account-a",
};
const disposers: Array<() => void> = [];
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
