import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => {
  const calls = {
    selectWhere: [] as unknown[],
    updateWhere: [] as unknown[],
    updateValues: [] as unknown[],
    rootSelectWhere: [] as unknown[],
    rootUpdateWhere: [] as unknown[],
    rootUpdateValues: [] as unknown[],
    deleteWhere: [] as unknown[],
    failDelete: false,
    selectRows: [] as Array<{
      id: string;
      name: string;
      condition: string;
      actions: string;
    }>,
    rootRows: [] as Array<Record<string, any>>,
  };
  const automationRules = {
    id: "id",
    ownerEmail: "ownerEmail",
    domain: "domain",
    kind: "kind",
    enabled: "enabled",
    name: "name",
    condition: "condition",
    actions: "actions",
  };
  const tx = {
    select: () => ({
      from: () => ({
        where: (condition: unknown) => ({
          for: async () => {
            calls.selectWhere.push(condition);
            return calls.selectRows;
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
  const db = {
    select: () => ({
      from: () => ({
        where: async (condition: unknown) => {
          calls.rootSelectWhere.push(condition);
          return calls.rootRows;
        },
      }),
    }),
    update: () => ({
      set: (values: Record<string, any>) => ({
        where: async (condition: unknown) => {
          calls.rootUpdateValues.push(values);
          calls.rootUpdateWhere.push(condition);
          Object.assign(calls.rootRows[0], values);
        },
      }),
    }),
    transaction: vi.fn(async (run: (transaction: typeof tx) => unknown) =>
      run(tx),
    ),
  };
  return {
    calls,
    automationRules,
    db,
  };
});

const jevMocks = vi.hoisted(() => ({
  getJevContextCredentials: vi.fn(),
  isJevEnabled: vi.fn(),
}));

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

vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

vi.mock("@agent-native/core/server", () => ({
  getJevContextCredentials: jevMocks.getJevContextCredentials,
  isJevEnabled: jevMocks.isJevEnabled,
}));

import {
  consolidateAutomationRules,
  updateAutomationRule,
} from "./automations.js";

function flatten(condition: any): any[] {
  return condition?.op === "and"
    ? condition.conditions.flatMap(flatten)
    : [condition];
}

function expectedRules() {
  const actions = [
    { type: "label" as const, labelName: "agent-native-important" },
  ];
  return [
    {
      id: "keep",
      name: "AI important",
      condition: "Original prompt",
      actions,
    },
    {
      id: "duplicate",
      name: "AI important: customers",
      condition: "Customer prompt",
      actions,
    },
  ];
}

beforeEach(() => {
  dbMock.calls.selectWhere.length = 0;
  dbMock.calls.updateWhere.length = 0;
  dbMock.calls.updateValues.length = 0;
  dbMock.calls.rootSelectWhere.length = 0;
  dbMock.calls.rootUpdateWhere.length = 0;
  dbMock.calls.rootUpdateValues.length = 0;
  dbMock.calls.deleteWhere.length = 0;
  dbMock.calls.failDelete = false;
  dbMock.calls.selectRows = expectedRules().map((rule) => ({
    ...rule,
    actions: JSON.stringify(rule.actions),
  }));
  dbMock.calls.rootRows = [
    {
      id: "keep",
      ownerEmail: "owner@example.test",
      domain: "mail",
      kind: "ai-filter",
      name: "AI important",
      condition: "Original prompt",
      actions: JSON.stringify([
        { type: "label", labelName: "agent-native-important" },
      ]),
      enabled: 1,
      createdAt: 1_700_000_000,
      updatedAt: 1_700_000_000,
    },
  ];
  dbMock.db.transaction.mockClear();
  jevMocks.getJevContextCredentials.mockClear();
  jevMocks.isJevEnabled.mockClear();
  jevMocks.getJevContextCredentials.mockResolvedValue({
    ownerEmail: "owner@example.test",
  });
  jevMocks.isJevEnabled.mockResolvedValue(true);
});

describe("consolidateAutomationRules", () => {
  it("keeps the update and duplicate delete in one owner-scoped transaction", async () => {
    dbMock.calls.failDelete = true;

    await expect(
      consolidateAutomationRules("owner@example.test", {
        id: "keep",
        duplicateIds: ["duplicate"],
        expectedRules: expectedRules(),
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

  it.each(["condition", "actions"])(
    "does not consolidate after a rule %s changes",
    async (field) => {
      const rule = dbMock.calls.selectRows[0];
      if (field === "condition") {
        rule.condition = "Prompt edited elsewhere";
      } else {
        rule.actions = '[{"type":"archive"}]';
      }

      const saved = await consolidateAutomationRules("owner@example.test", {
        id: "keep",
        duplicateIds: ["duplicate"],
        expectedRules: expectedRules(),
        name: "AI important: Updated prompt",
        condition: "Updated prompt",
        actions: [{ type: "label", labelName: "agent-native-important" }],
      });

      expect(saved).toBe(false);
      expect(dbMock.calls.updateWhere).toHaveLength(0);
      expect(dbMock.calls.deleteWhere).toHaveLength(0);
    },
  );

  it("requires Jev to edit an AI-filter rule", async () => {
    jevMocks.isJevEnabled.mockResolvedValue(false);

    await expect(
      updateAutomationRule("owner@example.test", "keep", {
        condition: "Changed prompt",
      }),
    ).rejects.toMatchObject({ errorCode: "jev_not_enabled", statusCode: 403 });

    expect(dbMock.calls.rootUpdateWhere).toHaveLength(0);
  });

  it.each([
    ["kind", { kind: "automation" as const, condition: "Changed prompt" }],
    ["domain", { domain: "calendar", condition: "Changed prompt" }],
  ])(
    "requires Jev before downgrading an AI-filter rule by %s",
    async (_field, patch) => {
      jevMocks.isJevEnabled.mockResolvedValue(false);

      await expect(
        updateAutomationRule("owner@example.test", "keep", patch),
      ).rejects.toMatchObject({
        errorCode: "jev_not_enabled",
        statusCode: 403,
      });

      expect(dbMock.calls.rootUpdateWhere).toHaveLength(0);
    },
  );

  it("allows disabling an AI-filter rule when Jev is unavailable", async () => {
    jevMocks.isJevEnabled.mockResolvedValue(false);

    await updateAutomationRule("owner@example.test", "keep", {
      enabled: false,
    });

    expect(jevMocks.isJevEnabled).not.toHaveBeenCalled();
    expect(dbMock.calls.rootUpdateValues).toEqual([
      { enabled: 0, updatedAt: expect.any(Number) },
    ]);
  });

  it("does not require Jev to edit a regular automation", async () => {
    dbMock.calls.rootRows[0].kind = "automation";
    jevMocks.isJevEnabled.mockResolvedValue(false);

    await updateAutomationRule("owner@example.test", "keep", {
      condition: "Changed prompt",
    });

    expect(jevMocks.isJevEnabled).not.toHaveBeenCalled();
    expect(dbMock.calls.rootUpdateValues[0]).toMatchObject({
      condition: "Changed prompt",
    });
  });

  it("requires Jev before consolidating AI-filter rules", async () => {
    jevMocks.isJevEnabled.mockResolvedValue(false);

    await expect(
      consolidateAutomationRules("owner@example.test", {
        id: "keep",
        duplicateIds: ["duplicate"],
        expectedRules: expectedRules(),
        name: "Updated",
        condition: "Updated prompt",
        actions: [{ type: "label", labelName: "agent-native-important" }],
      }),
    ).rejects.toMatchObject({ errorCode: "jev_not_enabled", statusCode: 403 });

    expect(dbMock.db.transaction).not.toHaveBeenCalled();
  });
});
