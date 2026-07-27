import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let sqlite: Database.Database;

async function execute(
  input: string | { sql: string; args?: unknown[] },
): Promise<{ rows: unknown[]; rowsAffected: number }> {
  if (typeof input === "string") {
    sqlite.exec(input);
    return { rows: [], rowsAffected: 0 };
  }
  const statement = sqlite.prepare(input.sql);
  const args = input.args ?? [];
  if (statement.reader) {
    return { rows: statement.all(...args), rowsAffected: 0 };
  }
  const result = statement.run(...args);
  return { rows: [], rowsAffected: result.changes };
}

const db = {
  execute: vi.fn(execute),
  transaction: async <T>(
    fn: (tx: { execute: typeof execute }) => Promise<T>,
  ) => {
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      const result = await fn({ execute });
      sqlite.exec("COMMIT");
      return result;
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  },
};

vi.mock("../db/client.js", () => ({
  getDbExec: () => db,
  intType: () => "INTEGER",
  isPostgres: () => false,
}));

const { _resetIntegrationScopeStoreForTests, saveIntegrationScope } =
  await import("./scope-store.js");
const {
  _resetIntegrationUsageBudgetStoreForTests,
  getIntegrationBudgetSnapshot,
  getIntegrationUsageBudget,
  listIntegrationUsageBudgets,
  listIntegrationBudgetThresholdEvents,
  releaseIntegrationUsageBudget,
  reserveIntegrationUsageBudget,
  saveIntegrationUsageBudget,
  settleIntegrationUsageBudget,
} = await import("./usage-budget-store.js");

const access = { ownerEmail: "owner@example.com", orgId: "org-example" };

beforeEach(() => {
  sqlite = new Database(":memory:");
  db.execute.mockClear();
  _resetIntegrationScopeStoreForTests();
  _resetIntegrationUsageBudgetStoreForTests();
});

afterEach(() => {
  sqlite.close();
});

describe("integration usage budget reservations", () => {
  it("atomically rejects concurrent reservations that would exceed the cap", async () => {
    const budget = await saveIntegrationUsageBudget(
      {
        subject: { type: "org", orgId: "org-example" },
        period: "day",
        limitMicros: 1_000,
        thresholdBps: 5_000,
      },
      access,
    );
    const timestamp = Date.UTC(2026, 6, 10, 12);

    const results = await Promise.all([
      reserveIntegrationUsageBudget(
        {
          budgetId: budget.id,
          reservationId: "run-a",
          estimatedCostMicros: 600,
          timestamp,
        },
        access,
      ),
      reserveIntegrationUsageBudget(
        {
          budgetId: budget.id,
          reservationId: "run-b",
          estimatedCostMicros: 600,
          timestamp,
        },
        access,
      ),
    ]);

    expect(results.filter((result) => result.allowed)).toHaveLength(1);
    expect(results.filter((result) => !result.allowed)).toHaveLength(1);
    const snapshot = await getIntegrationBudgetSnapshot(
      budget.id,
      access,
      timestamp,
    );
    expect(snapshot).toMatchObject({
      usedMicros: 0,
      reservedMicros: 600,
      remainingMicros: 400,
      costUnit: "currency_micros",
    });
  });

  it("settles and releases reservations without leaking reserved capacity", async () => {
    const budget = await saveIntegrationUsageBudget(
      {
        subject: { type: "user", userEmail: "owner@example.com" },
        period: "month",
        limitMicros: 2_000,
      },
      access,
    );
    const timestamp = Date.UTC(2026, 6, 10);
    await reserveIntegrationUsageBudget(
      {
        budgetId: budget.id,
        reservationId: "settled-run",
        estimatedCostMicros: 700,
        timestamp,
      },
      access,
    );
    await reserveIntegrationUsageBudget(
      {
        budgetId: budget.id,
        reservationId: "released-run",
        estimatedCostMicros: 400,
        timestamp,
      },
      access,
    );

    const settled = await settleIntegrationUsageBudget(
      {
        budgetId: budget.id,
        reservationId: "settled-run",
        actualCostMicros: 550,
      },
      access,
    );
    expect(settled).toMatchObject({
      status: "settled",
      settledCostMicros: 550,
    });
    const released = await releaseIntegrationUsageBudget(
      { budgetId: budget.id, reservationId: "released-run" },
      access,
    );
    expect(released.status).toBe("released");
    expect(released.snapshot).toMatchObject({
      usedMicros: 550,
      reservedMicros: 0,
      remainingMicros: 1_450,
    });
  });

  it("deduplicates threshold events for a budget window", async () => {
    const budget = await saveIntegrationUsageBudget(
      {
        subject: { type: "org", orgId: "org-example" },
        period: "day",
        limitMicros: 1_000,
        thresholdBps: 5_000,
      },
      access,
    );
    const timestamp = Date.UTC(2026, 6, 10);
    const first = await reserveIntegrationUsageBudget(
      {
        budgetId: budget.id,
        reservationId: "first",
        estimatedCostMicros: 600,
        timestamp,
      },
      access,
    );
    const second = await settleIntegrationUsageBudget(
      {
        budgetId: budget.id,
        reservationId: "first",
        actualCostMicros: 600,
      },
      access,
    );

    expect(first.thresholdEventEmitted).toBe(true);
    expect(second.thresholdEventEmitted).toBe(false);
    const events = await listIntegrationBudgetThresholdEvents(
      budget.id,
      access,
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      budgetId: budget.id,
      thresholdBps: 5_000,
      observedMicros: 600,
    });
  });

  it("charges actual cost even when it exceeds the reservation estimate", async () => {
    const budget = await saveIntegrationUsageBudget(
      {
        subject: { type: "org", orgId: "org-example" },
        period: "day",
        limitMicros: 1_000,
      },
      access,
    );
    await reserveIntegrationUsageBudget(
      {
        budgetId: budget.id,
        reservationId: "underestimated-run",
        estimatedCostMicros: 600,
      },
      access,
    );

    const settled = await settleIntegrationUsageBudget(
      {
        budgetId: budget.id,
        reservationId: "underestimated-run",
        actualCostMicros: 1_200,
      },
      access,
    );
    const snapshot = await getIntegrationBudgetSnapshot(budget.id, access);
    expect(settled.settledCostMicros).toBe(1_200);
    expect(snapshot).toMatchObject({
      usedMicros: 1_200,
      reservedMicros: 0,
      remainingMicros: 0,
    });
  });
});

describe("integration usage budget authorization", () => {
  it("types nullable org guards for Postgres parameter inference", async () => {
    await listIntegrationUsageBudgets({
      ownerEmail: "personal@example.com",
      orgId: null,
    });

    expect(db.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("CAST(? AS TEXT) IS NOT NULL"),
      }),
    );
  });

  it("keeps user budgets private from other members of the same org", async () => {
    const budget = await saveIntegrationUsageBudget(
      {
        subject: { type: "user", userEmail: "owner@example.com" },
        period: "day",
        limitMicros: 1_000,
      },
      access,
    );
    const otherMember = {
      ownerEmail: "other-member@example.com",
      orgId: "org-example",
    };

    await expect(
      getIntegrationUsageBudget(budget.id, otherMember),
    ).resolves.toBeNull();
    await expect(listIntegrationUsageBudgets(otherMember)).resolves.toEqual([]);
    await expect(
      reserveIntegrationUsageBudget(
        {
          budgetId: budget.id,
          reservationId: "other-member-run",
          estimatedCostMicros: 100,
        },
        otherMember,
      ),
    ).rejects.toThrow("not available");
  });

  it("denies cross-org scope budgets and reservation ids", async () => {
    const scopeKey = {
      platform: "slack",
      tenantId: "team-example",
      conversationId: "channel-example",
    };
    await saveIntegrationScope(
      { ...scopeKey, conversationType: "channel", trust: "trusted" },
      access,
    );
    const budget = await saveIntegrationUsageBudget(
      {
        subject: { type: "scope", scope: scopeKey },
        period: "month",
        limitMicros: 1_000,
      },
      access,
    );
    const otherOrg = {
      ownerEmail: "other@example.com",
      orgId: "other-org",
    };

    await expect(
      getIntegrationUsageBudget(budget.id, otherOrg),
    ).resolves.toBeNull();
    await expect(
      reserveIntegrationUsageBudget(
        {
          budgetId: budget.id,
          reservationId: "cross-org-run",
          estimatedCostMicros: 100,
        },
        otherOrg,
      ),
    ).rejects.toThrow("not available");
    await expect(
      saveIntegrationUsageBudget(
        {
          subject: { type: "scope", scope: scopeKey },
          period: "month",
          limitMicros: 1_000,
        },
        otherOrg,
      ),
    ).rejects.toThrow("not available");
  });
});
