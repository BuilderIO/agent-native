import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  eq: (column: { name: string }, value: unknown) => ({
    kind: "eq",
    column: column.name,
    value,
  }),
}));

import { remapDashboardViews } from "./dashboard-view-remap";

type ViewRow = { id: string; dashboardId: string; isDefault: boolean };

function matches(predicate: unknown, row: Record<string, unknown>): boolean {
  if (!predicate || typeof predicate !== "object") return true;
  const condition = predicate as {
    kind?: string;
    column?: string;
    value?: unknown;
    conditions?: unknown[];
  };
  if (condition.kind === "and") {
    return (condition.conditions ?? []).every((item) => matches(item, row));
  }
  if (condition.kind === "eq") {
    return row[condition.column ?? ""] === condition.value;
  }
  return true;
}

function createTransaction(
  rows: ViewRow[],
  dashboardRows = [
    "canonical",
    "duplicate",
    "older-duplicate",
    "newer-duplicate",
  ].map((id) => ({ id, orgId: "analytics-org" })),
) {
  const updateFields: string[] = [];
  const lockedDashboardIds: string[] = [];
  const operationOrder: string[] = [];
  const tx = {
    select: () => {
      let selectedTable: unknown;
      let predicate: unknown;
      const query = {
        from: (table: unknown) => {
          selectedTable = table;
          return query;
        },
        where: (nextPredicate: unknown) => {
          predicate = nextPredicate;
          return query;
        },
        limit: async () => {
          operationOrder.push("read-default");
          return rows.filter((row) => matches(predicate, row)).slice(0, 1);
        },
        for: async (mode: string) => {
          if (selectedTable === dashboardsTable && mode === "update") {
            const matchesInScope = dashboardRows.filter((row) =>
              matches(predicate, row),
            );
            for (const dashboard of matchesInScope) {
              lockedDashboardIds.push(dashboard.id);
              operationOrder.push(`lock:${dashboard.id}`);
            }
            return matchesInScope;
          }
          return [];
        },
      };
      return query;
    },
    update: () => ({
      set: (values: Partial<ViewRow>) => ({
        where: async (predicate: unknown) => {
          updateFields.push(Object.keys(values).join(","));
          for (const row of rows) {
            if (matches(predicate, row)) Object.assign(row, values);
          }
        },
      }),
    }),
  };
  return { tx, rows, updateFields, lockedDashboardIds, operationOrder };
}

const table = {
  id: { name: "id" },
  dashboardId: { name: "dashboardId" },
  isDefault: { name: "isDefault" },
};

const dashboardsTable = {
  id: { name: "id" },
  orgId: { name: "orgId" },
};

describe("remapDashboardViews", () => {
  it("demotes duplicate defaults when the canonical dashboard already has one", async () => {
    const store = createTransaction([
      { id: "canonical-default", dashboardId: "canonical", isDefault: true },
      { id: "duplicate-default", dashboardId: "duplicate", isDefault: true },
    ]);

    await remapDashboardViews(
      store.tx,
      dashboardsTable,
      table,
      "analytics-org",
      "duplicate",
      "canonical",
    );

    expect(store.rows).toEqual([
      { id: "canonical-default", dashboardId: "canonical", isDefault: true },
      { id: "duplicate-default", dashboardId: "canonical", isDefault: false },
    ]);
    expect(store.updateFields).toEqual(["isDefault", "dashboardId"]);
    expect(store.lockedDashboardIds).toEqual(["canonical", "duplicate"]);
    expect(store.operationOrder).toEqual([
      "lock:canonical",
      "lock:duplicate",
      "read-default",
    ]);
  });

  it("keeps the first remapped default when multiple duplicates are consolidated", async () => {
    const store = createTransaction([
      { id: "older-default", dashboardId: "older-duplicate", isDefault: true },
      { id: "newer-default", dashboardId: "newer-duplicate", isDefault: true },
    ]);

    await remapDashboardViews(
      store.tx,
      dashboardsTable,
      table,
      "analytics-org",
      "older-duplicate",
      "canonical",
    );
    await remapDashboardViews(
      store.tx,
      dashboardsTable,
      table,
      "analytics-org",
      "newer-duplicate",
      "canonical",
    );

    expect(store.rows).toEqual([
      { id: "older-default", dashboardId: "canonical", isDefault: true },
      { id: "newer-default", dashboardId: "canonical", isDefault: false },
    ]);
    expect(store.updateFields).toEqual([
      "dashboardId",
      "isDefault",
      "dashboardId",
    ]);
    expect(store.lockedDashboardIds).toEqual([
      "canonical",
      "older-duplicate",
      "canonical",
      "newer-duplicate",
    ]);
  });

  it("does not lock dashboards from another organization", async () => {
    const store = createTransaction(
      [],
      [
        { id: "canonical", orgId: "analytics-org" },
        { id: "duplicate", orgId: "another-org" },
      ],
    );

    await expect(
      remapDashboardViews(
        store.tx,
        dashboardsTable,
        table,
        "analytics-org",
        "duplicate",
        "canonical",
      ),
    ).rejects.toThrow("Dashboard duplicate was not available to lock");
    expect(store.lockedDashboardIds).toEqual(["canonical"]);
    expect(store.operationOrder).toEqual(["lock:canonical"]);
  });
});
