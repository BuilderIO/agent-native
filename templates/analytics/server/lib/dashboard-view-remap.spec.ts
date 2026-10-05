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

function createTransaction(rows: ViewRow[]) {
  const updateFields: string[] = [];
  const tx = {
    select: () => ({
      from: () => ({
        where: (predicate: unknown) => ({
          limit: async () =>
            rows.filter((row) => matches(predicate, row)).slice(0, 1),
        }),
      }),
    }),
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
  return { tx, rows, updateFields };
}

const table = {
  id: { name: "id" },
  dashboardId: { name: "dashboardId" },
  isDefault: { name: "isDefault" },
};

describe("remapDashboardViews", () => {
  it("demotes duplicate defaults when the canonical dashboard already has one", async () => {
    const store = createTransaction([
      { id: "canonical-default", dashboardId: "canonical", isDefault: true },
      { id: "duplicate-default", dashboardId: "duplicate", isDefault: true },
    ]);

    await remapDashboardViews(store.tx, table, "duplicate", "canonical");

    expect(store.rows).toEqual([
      { id: "canonical-default", dashboardId: "canonical", isDefault: true },
      { id: "duplicate-default", dashboardId: "canonical", isDefault: false },
    ]);
    expect(store.updateFields).toEqual(["isDefault", "dashboardId"]);
  });

  it("keeps the first remapped default when multiple duplicates are consolidated", async () => {
    const store = createTransaction([
      { id: "older-default", dashboardId: "older-duplicate", isDefault: true },
      { id: "newer-default", dashboardId: "newer-duplicate", isDefault: true },
    ]);

    await remapDashboardViews(store.tx, table, "older-duplicate", "canonical");
    await remapDashboardViews(store.tx, table, "newer-duplicate", "canonical");

    expect(store.rows).toEqual([
      { id: "older-default", dashboardId: "canonical", isDefault: true },
      { id: "newer-default", dashboardId: "canonical", isDefault: false },
    ]);
    expect(store.updateFields).toEqual([
      "dashboardId",
      "isDefault",
      "dashboardId",
    ]);
  });
});
