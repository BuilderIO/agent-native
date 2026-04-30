import { defineEventHandler, getRouterParam, createError } from "h3";
import { nanoid } from "nanoid";
import { eq, and } from "drizzle-orm";
import { readBody, getSession } from "@agent-native/core/server";
import { db, schema } from "../db/index.js";
import { triggerAutomationsDebounced } from "../lib/automation-engine.js";
import type { AutomationAction, AutomationRule } from "@shared/types.js";

function toApiRule(row: any): AutomationRule {
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

// ─── List automations ────────────────────────────────────────────────────────

export const listAutomations = defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const ownerEmail = session.email;

  const rules = await db
    .select()
    .from(schema.automationRules)
    .where(eq(schema.automationRules.ownerEmail, ownerEmail));

  return rules.map(toApiRule);
});

// ─── Create automation ───────────────────────────────────────────────────────

export const createAutomation = defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const ownerEmail = session.email;

  const body = await readBody(event);
  const { name, condition, actions, domain = "mail", enabled = true } = body;

  if (!name || !condition || !actions) {
    throw new Error("name, condition, and actions are required");
  }

  const now = Date.now();
  const rule = {
    id: nanoid(12),
    ownerEmail,
    domain,
    name,
    condition,
    actions: JSON.stringify(actions),
    enabled: enabled ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(schema.automationRules).values(rule as any);
  return toApiRule(rule);
});

// ─── Update automation ───────────────────────────────────────────────────────

export const updateAutomation = defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const ownerEmail = session.email;
  const id = getRouterParam(event, "id");

  if (!id) throw new Error("id is required");

  const body = await readBody(event);
  const updates: Record<string, any> = { updatedAt: Date.now() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.condition !== undefined) updates.condition = body.condition;
  if (body.actions !== undefined)
    updates.actions = JSON.stringify(body.actions);
  if (body.enabled !== undefined) updates.enabled = body.enabled ? 1 : 0;
  if (body.domain !== undefined) updates.domain = body.domain;

  await db
    .update(schema.automationRules)
    .set(updates)
    .where(
      and(
        eq(schema.automationRules.id, id),
        eq(schema.automationRules.ownerEmail, ownerEmail),
      ),
    );

  // Fetch and return updated rule
  const [updated] = await db
    .select()
    .from(schema.automationRules)
    .where(eq(schema.automationRules.id, id));

  if (!updated) throw new Error("Rule not found");
  return toApiRule(updated);
});

// ─── Delete automation ───────────────────────────────────────────────────────

export const deleteAutomation = defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session?.email) {
    throw createError({ statusCode: 401, statusMessage: "Unauthenticated" });
  }
  const ownerEmail = session.email;
  const id = getRouterParam(event, "id");

  if (!id) throw new Error("id is required");

  await db
    .delete(schema.automationRules)
    .where(
      and(
        eq(schema.automationRules.id, id),
        eq(schema.automationRules.ownerEmail, ownerEmail),
      ),
    );

  return { success: true };
});

// ─── Trigger automations ─────────────────────────────────────────────────────

export const triggerAutomations = defineEventHandler(async (event) => {
  const session = await getSession(event);
  if (!session) {
    throw createError({ statusCode: 401, message: "Unauthorized" });
  }
  return triggerAutomationsDebounced();
});
