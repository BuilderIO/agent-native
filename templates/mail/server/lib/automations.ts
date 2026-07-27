import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AutomationAction, AutomationRule } from "../../shared/types.js";
import { db, schema } from "../db/index.js";

export function toApiRule(row: any): AutomationRule {
  return {
    id: row.id,
    ownerEmail: row.ownerEmail,
    domain: row.domain,
    name: row.name,
    condition: row.condition,
    actions: JSON.parse(row.actions),
    enabled: row.enabled === 1 || row.enabled === true || row.enabled === "1",
    createdAt: new Date(Number(row.createdAt)).toISOString(),
    updatedAt: new Date(Number(row.updatedAt)).toISOString(),
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
    enabled?: boolean;
  },
): Promise<AutomationRule> {
  const now = Date.now();
  const rule = {
    id: nanoid(12),
    ownerEmail,
    domain: input.domain ?? "mail",
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
  },
): Promise<AutomationRule> {
  const updates: Record<string, any> = { updatedAt: Date.now() };
  if (patch.name !== undefined) updates.name = patch.name;
  if (patch.condition !== undefined) updates.condition = patch.condition;
  if (patch.actions !== undefined) {
    updates.actions = JSON.stringify(patch.actions);
  }
  if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
  if (patch.domain !== undefined) updates.domain = patch.domain;

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
