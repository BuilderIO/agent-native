import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { AutomationAction, AutomationRule } from "../../shared/types.js";
import { db, schema } from "../db/index.js";

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
