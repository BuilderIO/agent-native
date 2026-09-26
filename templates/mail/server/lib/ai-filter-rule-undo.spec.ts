import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const rules: Array<Record<string, any>> = [];
  const undoRows: Array<Record<string, any>> = [];
  let failRuleDelete = false;
  const makeColumns = (table: string, names: string[]) =>
    Object.fromEntries(names.map((name) => [name, { table, name }]));
  const automationRules = {
    __table: "rules",
    ...makeColumns("rules", [
      "id",
      "ownerEmail",
      "domain",
      "kind",
      "enabled",
      "name",
      "condition",
      "actions",
      "createdAt",
      "updatedAt",
    ]),
  };
  const aiFilterRuleUndo = {
    __table: "undo",
    ...makeColumns("undo", ["id", "ownerEmail", "rulesJson", "expiresAt"]),
  };

  function matches(condition: any, row: Record<string, any>): boolean {
    if (condition?.op === "and") {
      return condition.conditions.every((item: any) => matches(item, row));
    }
    if (condition?.op === "eq")
      return row[condition.column.name] === condition.value;
    if (condition?.op === "gt")
      return row[condition.column.name] > condition.value;
    if (condition?.op === "lt")
      return row[condition.column.name] < condition.value;
    if (condition?.op === "inArray") {
      return condition.values.includes(row[condition.column.name]);
    }
    return false;
  }

  const tx = {
    select: () => ({
      from: (table: { __table: string }) => ({
        where: (condition: unknown) => ({
          for: async () =>
            (table.__table === "rules" ? rules : undoRows)
              .filter((row) => matches(condition, row))
              .map((row) => structuredClone(row)),
        }),
      }),
    }),
    insert: (table: { __table: string }) => ({
      values: async (values: Record<string, any> | Record<string, any>[]) => {
        const target = table.__table === "rules" ? rules : undoRows;
        target.push(
          ...(Array.isArray(values) ? values : [values]).map((row) =>
            structuredClone(row),
          ),
        );
      },
    }),
    delete: (table: { __table: string }) => ({
      where: (condition: unknown) => ({
        returning: async () => {
          const target = table.__table === "rules" ? rules : undoRows;
          const deleted = target.filter((row) => matches(condition, row));
          const kept = target.filter((row) => !matches(condition, row));
          target.splice(0, target.length, ...kept);
          if (table.__table === "rules" && failRuleDelete) {
            failRuleDelete = false;
            throw new Error("delete failed");
          }
          return deleted.map(({ id }) => ({ id }));
        },
      }),
    }),
  };

  const db = {
    delete: tx.delete,
    transaction: async (run: (transaction: typeof tx) => unknown) => {
      const rulesBefore = structuredClone(rules);
      const undoBefore = structuredClone(undoRows);
      try {
        return await run(tx);
      } catch (error) {
        rules.splice(0, rules.length, ...rulesBefore);
        undoRows.splice(0, undoRows.length, ...undoBefore);
        throw error;
      }
    },
  };

  return {
    rules,
    undoRows,
    failRuleDelete: (value: boolean) => {
      failRuleDelete = value;
    },
    db,
    schema: { automationRules, aiFilterRuleUndo },
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  eq: (column: unknown, value: unknown) => ({ op: "eq", column, value }),
  gt: (column: unknown, value: unknown) => ({ op: "gt", column, value }),
  inArray: (column: unknown, values: unknown[]) => ({
    op: "inArray",
    column,
    values,
  }),
  lt: (column: unknown, value: unknown) => ({ op: "lt", column, value }),
}));

vi.mock("nanoid", () => ({ nanoid: () => "undo-token" }));
vi.mock("../db/index.js", () => ({
  db: database.db,
  schema: database.schema,
}));
vi.mock("@agent-native/core/action", () => ({
  fail: (message: string, details: Record<string, unknown>) => {
    throw Object.assign(new Error(message), details);
  },
}));

import {
  clearMailAiFilterRules,
  purgeExpiredMailAiFilterRuleUndoSnapshots,
  restoreMailAiFilterRules,
} from "./ai-filter-rule-undo.js";

const owner = "mail-test@example.test";
const firstRule = {
  id: "important",
  ownerEmail: owner,
  domain: "mail",
  kind: "ai-filter",
  name: "AI important",
  condition: "Important mail",
  actions: '[{"type":"label","labelName":"agent-native-important"}]',
  enabled: 1,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};
const secondRule = {
  ...firstRule,
  id: "archive",
  name: "AI skip inbox",
  condition: "Automated notifications",
  actions: '[{"type":"archive"}]',
};
const unrelatedRule = {
  ...firstRule,
  id: "ordinary",
  kind: "automation",
};

describe("AI-filter rule undo", () => {
  beforeEach(() => {
    database.rules.splice(
      0,
      database.rules.length,
      structuredClone(firstRule),
      structuredClone(secondRule),
      structuredClone(unrelatedRule),
      {
        ...structuredClone(firstRule),
        id: "other-owner",
        ownerEmail: "other@example.test",
      },
      { ...structuredClone(firstRule), id: "disabled", enabled: 0 },
    );
    database.undoRows.splice(0, database.undoRows.length);
    database.failRuleDelete(false);
  });

  it("purges expired snapshots while retaining live snapshots", async () => {
    const now = Math.floor(Date.now() / 1_000);
    database.undoRows.push(
      { id: "expired", ownerEmail: owner, rulesJson: "[]", expiresAt: now - 1 },
      {
        id: "other-expired",
        ownerEmail: "other@example.test",
        rulesJson: "[]",
        expiresAt: now - 1,
      },
      {
        id: "live",
        ownerEmail: owner,
        rulesJson: "[]",
        expiresAt: now + 3_600,
      },
    );

    await purgeExpiredMailAiFilterRuleUndoSnapshots();

    expect(database.undoRows.map((row) => row.id)).toEqual(["live"]);
  });

  it("atomically clears only requested active owned AI rules and restores the exact snapshot once", async () => {
    const undoId = await clearMailAiFilterRules(owner, [
      firstRule.id,
      secondRule.id,
    ]);

    expect(undoId).toBe("undo-token");
    expect(database.rules.map((rule) => rule.id)).toEqual([
      "ordinary",
      "other-owner",
      "disabled",
    ]);
    expect(JSON.parse(database.undoRows[0].rulesJson)).toEqual([
      firstRule,
      secondRule,
    ]);

    await restoreMailAiFilterRules(owner, undoId);
    expect(database.rules).toEqual([
      unrelatedRule,
      { ...firstRule, id: "other-owner", ownerEmail: "other@example.test" },
      { ...firstRule, id: "disabled", enabled: 0 },
      firstRule,
      secondRule,
    ]);
    expect(database.undoRows).toHaveLength(0);
    await expect(restoreMailAiFilterRules(owner, undoId)).rejects.toMatchObject(
      {
        errorCode: "undo_expired",
      },
    );
  });

  it("rolls the whole clear back if deleting any rule fails", async () => {
    database.failRuleDelete(true);

    await expect(
      clearMailAiFilterRules(owner, [firstRule.id, secondRule.id]),
    ).rejects.toThrow("delete failed");

    expect(database.rules).toHaveLength(5);
    expect(database.undoRows).toHaveLength(0);
  });

  it("does not issue undo tokens for rules outside the owner's active Mail AI filters", async () => {
    await expect(
      clearMailAiFilterRules(owner, ["ordinary"]),
    ).rejects.toMatchObject({
      errorCode: "rules_changed",
    });
    await expect(
      clearMailAiFilterRules(owner, [firstRule.id, firstRule.id]),
    ).rejects.toMatchObject({ errorCode: "invalid_rule_ids" });
    expect(database.rules).toHaveLength(5);
    expect(database.undoRows).toHaveLength(0);
  });

  it("scopes undo tokens to their owner and expiry", async () => {
    const undoId = await clearMailAiFilterRules(owner, [firstRule.id]);
    await expect(
      restoreMailAiFilterRules("other@example.test", undoId),
    ).rejects.toMatchObject({ errorCode: "undo_expired" });

    database.undoRows[0].expiresAt = Math.floor(Date.now() / 1_000) - 1;
    await expect(restoreMailAiFilterRules(owner, undoId)).rejects.toMatchObject(
      {
        errorCode: "undo_expired",
      },
    );
  });
});
