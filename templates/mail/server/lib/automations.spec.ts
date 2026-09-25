import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const calls = {
    selectWhere: [] as unknown[],
    updateWhere: [] as unknown[],
    updateValues: [] as unknown[],
    deleteWhere: [] as unknown[],
    failDelete: false,
  };
  const automationRules = {
    id: "id",
    ownerEmail: "ownerEmail",
    domain: "domain",
    kind: "kind",
    enabled: "enabled",
  };
  const tx = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          for: async () => {
            calls.selectWhere.push(condition);
            return [{ id: "keep" }, { id: "duplicate" }];
          },
        }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: (condition: unknown) => ({
          returning: async () => {
            calls.updateValues.push(values);
            calls.updateWhere.push(condition);
            return [{ id: "keep" }];
          },
        }),
      }),
    }),
    delete: () => ({
      where: (condition: unknown) => ({
        returning: async () => {
          calls.deleteWhere.push(condition);
          if (calls.failDelete) throw new Error("delete failed");
          return [{ id: "duplicate" }];
        },
      }),
    }),
  };
  return {
    calls,
    automationRules,
    db: {
      transaction: vi.fn(async (run: (transaction: typeof tx) => unknown) =>
        run(tx),
      ),
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    op: "inArray",
    column,
    values,
  }),
}));

vi.mock("../db/index.js", () => ({
  db: dbMock.db,
  schema: { automationRules: dbMock.automationRules },
}));

import { consolidateAutomationRules } from "./automations.js";

function flatten(condition: any): any[] {
  return condition?.op === "and"
    ? condition.conditions.flatMap(flatten)
    : [condition];
}

beforeEach(() => {
  dbMock.calls.selectWhere.length = 0;
  dbMock.calls.updateWhere.length = 0;
  dbMock.calls.updateValues.length = 0;
  dbMock.calls.deleteWhere.length = 0;
  dbMock.calls.failDelete = false;
  dbMock.db.transaction.mockClear();
});

describe("consolidateAutomationRules", () => {
  it("keeps the update and duplicate delete in one owner-scoped transaction", async () => {
    dbMock.calls.failDelete = true;

    await expect(
      consolidateAutomationRules("owner@example.test", {
        id: "keep",
        duplicateIds: ["duplicate"],
        name: "AI important: Updated prompt",
        condition: "Updated prompt",
        actions: [{ type: "label", labelName: "agent-native-important" }],
      }),
    ).rejects.toThrow("delete failed");

    expect(dbMock.db.transaction).toHaveBeenCalledOnce();
    expect(dbMock.calls.updateWhere).toHaveLength(1);
    expect(dbMock.calls.deleteWhere).toHaveLength(1);
    for (const condition of [
      dbMock.calls.selectWhere[0],
      dbMock.calls.updateWhere[0],
      dbMock.calls.deleteWhere[0],
    ]) {
      expect(flatten(condition)).toEqual(
        expect.arrayContaining([
          {
            op: "eq",
            column: "ownerEmail",
            value: "owner@example.test",
          },
          { op: "eq", column: "domain", value: "mail" },
          { op: "eq", column: "kind", value: "ai-filter" },
          { op: "eq", column: "enabled", value: 1 },
        ]),
      );
    }
    expect(flatten(dbMock.calls.selectWhere[0])).toContainEqual({
      op: "inArray",
      column: "id",
      values: ["keep", "duplicate"],
    });
    expect(flatten(dbMock.calls.updateWhere[0])).toContainEqual({
      op: "eq",
      column: "id",
      value: "keep",
    });
    expect(flatten(dbMock.calls.deleteWhere[0])).toContainEqual({
      op: "inArray",
      column: "id",
      values: ["duplicate"],
    });
  });
});
