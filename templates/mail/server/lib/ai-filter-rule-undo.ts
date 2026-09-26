import { fail } from "@agent-native/core/action";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { nanoid } from "nanoid";

import { db, schema } from "../db/index.js";

const undoLifetimeSeconds = 60;

export async function clearMailAiFilterRules(
  ownerEmail: string,
  ids: string[],
): Promise<string> {
  const uniqueIds = [...new Set(ids)];
  if (
    uniqueIds.length !== ids.length ||
    uniqueIds.length === 0 ||
    uniqueIds.length > 32
  ) {
    fail("AI-filter rule ids must be unique and contain 1 to 32 ids.", {
      errorCode: "invalid_rule_ids",
      statusCode: 400,
    });
  }

  const now = Math.floor(Date.now() / 1_000);
  const undoId = nanoid(24);
  return db.transaction(async (tx: any) => {
    await tx
      .delete(schema.aiFilterRuleUndo)
      .where(
        and(
          eq(schema.aiFilterRuleUndo.ownerEmail, ownerEmail),
          lt(schema.aiFilterRuleUndo.expiresAt, now),
        ),
      )
      .returning({ id: schema.aiFilterRuleUndo.id });

    const rules = await tx
      .select()
      .from(schema.automationRules)
      .where(
        and(
          eq(schema.automationRules.ownerEmail, ownerEmail),
          eq(schema.automationRules.domain, "mail"),
          eq(schema.automationRules.kind, "ai-filter"),
          eq(schema.automationRules.enabled, 1),
          inArray(schema.automationRules.id, uniqueIds),
        ),
      )
      .for("update");
    if (rules.length !== uniqueIds.length) {
      fail("Some AI-filter rules changed before they could be cleared.", {
        errorCode: "rules_changed",
        statusCode: 409,
      });
    }

    await tx.insert(schema.aiFilterRuleUndo).values({
      id: undoId,
      ownerEmail,
      rulesJson: JSON.stringify(rules),
      expiresAt: now + undoLifetimeSeconds,
    });

    const deleted = await tx
      .delete(schema.automationRules)
      .where(
        and(
          eq(schema.automationRules.ownerEmail, ownerEmail),
          eq(schema.automationRules.domain, "mail"),
          eq(schema.automationRules.kind, "ai-filter"),
          eq(schema.automationRules.enabled, 1),
          inArray(schema.automationRules.id, uniqueIds),
        ),
      )
      .returning({ id: schema.automationRules.id });
    if (deleted.length !== uniqueIds.length) {
      fail("Some AI-filter rules changed before they could be cleared.", {
        errorCode: "rules_changed",
        statusCode: 409,
      });
    }
    return undoId;
  });
}

export async function restoreMailAiFilterRules(
  ownerEmail: string,
  undoId: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1_000);
  await db.transaction(async (tx: any) => {
    const [undo] = await tx
      .select()
      .from(schema.aiFilterRuleUndo)
      .where(
        and(
          eq(schema.aiFilterRuleUndo.id, undoId),
          eq(schema.aiFilterRuleUndo.ownerEmail, ownerEmail),
          gt(schema.aiFilterRuleUndo.expiresAt, now),
        ),
      )
      .for("update");
    if (!undo) {
      fail("This rule undo has expired or was already used.", {
        errorCode: "undo_expired",
        statusCode: 410,
      });
    }

    const rules = JSON.parse(undo.rulesJson);
    if (
      !Array.isArray(rules) ||
      rules.some(
        (rule) =>
          rule.ownerEmail !== ownerEmail ||
          rule.domain !== "mail" ||
          rule.kind !== "ai-filter" ||
          rule.enabled !== 1,
      )
    ) {
      throw new Error("AI-filter undo snapshot is invalid");
    }

    await tx.insert(schema.automationRules).values(rules);
    const consumed = await tx
      .delete(schema.aiFilterRuleUndo)
      .where(
        and(
          eq(schema.aiFilterRuleUndo.id, undoId),
          eq(schema.aiFilterRuleUndo.ownerEmail, ownerEmail),
          gt(schema.aiFilterRuleUndo.expiresAt, now),
        ),
      )
      .returning({ id: schema.aiFilterRuleUndo.id });
    if (consumed.length !== 1) {
      fail("This rule undo has expired or was already used.", {
        errorCode: "undo_expired",
        statusCode: 410,
      });
    }
  });
}
