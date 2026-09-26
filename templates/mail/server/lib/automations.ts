import { fail } from "@agent-native/core/action";
import {
  getJevContextCredentials,
  isJevEnabled,
} from "@agent-native/core/server";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AutomationAction, AutomationRule } from "../../shared/types.js";
import { db, schema } from "../db/index.js";

export async function assertMailJevEnabled(ownerEmail: string): Promise<void> {
  const credentials = await getJevContextCredentials(ownerEmail);
  if (!(await isJevEnabled(credentials))) {
    fail("Jev is not enabled for this account.", {
      errorCode: "jev_not_enabled",
      statusCode: 403,
    });
  }
}

export function toApiRule(row: any): AutomationRule {
  const kind = row.kind ?? "automation";
  if (kind !== "automation" && kind !== "ai-filter") {
    throw new Error(`Unknown automation rule kind: ${kind}`);
  }
  const createdAt = Number(row.createdAt);
  const updatedAt = Number(row.updatedAt);
  const toDate = (value: number) =>
    new Date(value < 10_000_000_000 ? value * 1_000 : value).toISOString();
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    domain: row.domain,
    kind,
    name: row.name,
    condition: row.condition,
    actions: JSON.parse(row.actions),
    enabled: row.enabled === 1 || row.enabled === true || row.enabled === "1",
    createdAt: toDate(createdAt),
    updatedAt: toDate(updatedAt),
  };
}

function ownedRule(ownerEmail: string, id: string) {
  return and(
    eq(schema.automationRules.id, id),
    eq(schema.automationRules.ownerEmail, ownerEmail),
  );
}

export async function listAutomationRules(
  ownerEmail: string,
): Promise<AutomationRule[]> {
  const rules = await db
    .select()
    .from(schema.automationRules)
    .where(eq(schema.automationRules.ownerEmail, ownerEmail));
  return rules.map(toApiRule);
}

export async function createAutomationRule(
  ownerEmail: string,
  input: {
    name: string;
    condition: string;
    actions: AutomationAction[];
    domain?: string;
    kind?: "automation" | "ai-filter";
    enabled?: boolean;
  },
): Promise<AutomationRule> {
  const now = Math.floor(Date.now() / 1_000);
  const rule = {
    id: nanoid(12),
    ownerEmail,
    domain: input.domain ?? "mail",
    kind: input.kind ?? "automation",
    name: input.name,
    condition: input.condition,
    actions: JSON.stringify(input.actions),
    enabled: (input.enabled ?? true) ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.automationRules).values(rule as any);
  return toApiRule(rule);
}

export async function updateAutomationRule(
  ownerEmail: string,
  id: string,
  patch: {
    name?: string;
    condition?: string;
    actions?: AutomationAction[];
    enabled?: boolean;
    domain?: string;
    kind?: "automation" | "ai-filter";
  },
): Promise<AutomationRule> {
  const [existing] = await db
    .select()
    .from(schema.automationRules)
    .where(ownedRule(ownerEmail, id));
  if (!existing) throw new Error("Rule not found");

  const existingIsMailAiFilter =
    existing.domain === "mail" &&
    (existing.kind ?? "automation") === "ai-filter";
  const nextDomain = patch.domain ?? existing.domain;
  const nextKind = patch.kind ?? existing.kind ?? "automation";
  const disableOnly =
    Object.keys(patch).length === 1 && patch.enabled === false;
  const nextIsMailAiFilter = nextDomain === "mail" && nextKind === "ai-filter";
  if ((existingIsMailAiFilter || nextIsMailAiFilter) && !disableOnly) {
    await assertMailJevEnabled(ownerEmail);
  }

  const updates: Record<string, any> = {
    updatedAt: Math.floor(Date.now() / 1_000),
  };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.condition !== undefined) updates.condition = patch.condition;
  if (patch.actions !== undefined) {
    updates.actions = JSON.stringify(patch.actions);
  }
  if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
  if (patch.domain !== undefined) updates.domain = patch.domain;
  if (patch.kind !== undefined) updates.kind = patch.kind;

  await db
    .update(schema.automationRules)
    .set(updates)
    .where(ownedRule(ownerEmail, id));

  const [updated] = await db
    .select()
    .from(schema.automationRules)
    .where(ownedRule(ownerEmail, id));

  if (!updated) throw new Error("Rule not found");
  return toApiRule(updated);
}

export async function deleteAutomationRule(
  ownerEmail: string,
  id: string,
): Promise<void> {
  await db.delete(schema.automationRules).where(ownedRule(ownerEmail, id));
}

export async function consolidateAutomationRules(
  ownerEmail: string,
  input: {
    id: string;
    duplicateIds: string[];
    expectedRules: {
      id: string;
      name: string;
      condition: string;
      actions: AutomationAction[];
    }[];
    name: string;
    condition: string;
    actions: AutomationAction[];
  },
): Promise<boolean> {
  await assertMailJevEnabled(ownerEmail);
  const ids = [input.id, ...input.duplicateIds];
  if (new Set(ids).size !== ids.length) return false;

  return db.transaction(async (tx: any) => {
    const matching = await tx
      .select({
        id: schema.automationRules.id,
        name: schema.automationRules.name,
        condition: schema.automationRules.condition,
        actions: schema.automationRules.actions,
      })
      .from(schema.automationRules)
      .where(
        and(
          eq(schema.automationRules.ownerEmail, ownerEmail),
          inArray(schema.automationRules.id, ids),
          eq(schema.automationRules.domain, "mail"),
          eq(schema.automationRules.kind, "ai-filter"),
          eq(schema.automationRules.enabled, 1),
        ),
      )
      .for("update");
    if (matching.length !== ids.length) return false;

    const expectedById = new Map(
      input.expectedRules.map((rule) => [rule.id, rule]),
    );
    if (
      expectedById.size !== ids.length ||
      ids.some((id) => !expectedById.has(id)) ||
      matching.some((rule: any) => {
        const expected = expectedById.get(rule.id);
        return (
          !expected ||
          expected.name !== rule.name ||
          expected.condition !== rule.condition ||
          JSON.stringify(expected.actions) !==
            JSON.stringify(JSON.parse(rule.actions))
        );
      })
    ) {
      return false;
    }

    const ownerRule = and(
      eq(schema.automationRules.ownerEmail, ownerEmail),
      eq(schema.automationRules.domain, "mail"),
      eq(schema.automationRules.kind, "ai-filter"),
      eq(schema.automationRules.enabled, 1),
    );
    const updated = await tx
      .update(schema.automationRules)
      .set({
        name: input.name,
        condition: input.condition,
        actions: JSON.stringify(input.actions),
        updatedAt: Math.floor(Date.now() / 1_000),
      })
      .where(and(ownerRule, eq(schema.automationRules.id, input.id)))
      .returning({ id: schema.automationRules.id });
    if (updated.length !== 1) {
      throw new Error("Prompt rule changed during consolidation");
    }

    if (input.duplicateIds.length) {
      const deleted = await tx
        .delete(schema.automationRules)
        .where(
          and(
            ownerRule,
            inArray(schema.automationRules.id, input.duplicateIds),
          ),
        )
        .returning({ id: schema.automationRules.id });
      if (deleted.length !== input.duplicateIds.length) {
        throw new Error("Duplicate prompt rules changed during consolidation");
      }
    }

    return true;
  });
}
