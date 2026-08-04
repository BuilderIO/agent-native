import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  defineAutomation,
  deleteAutomation,
  updateAutomation,
} from "../../automations/service.js";
import { refreshEventSubscriptions } from "../dispatcher.js";

const scopeSchema = z.enum(["personal", "organization"]);
const triggerTypeSchema = z.enum(["schedule", "event", "manual"]);
const mcpToolsSchema = z.array(z.string().min(1));

const automationFieldsSchema = {
  enabled: z.boolean().optional(),
  triggerType: triggerTypeSchema.optional(),
  event: z.string().min(1).optional(),
  schedule: z.string().min(1).optional(),
  timezone: z.string().min(1).optional(),
  condition: z.string().nullable().optional(),
  body: z.string().min(1).optional(),
  model: z.string().nullable().optional(),
  mcpTools: mcpToolsSchema.optional(),
};

const schema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    name: z.string().min(1),
    scope: scopeSchema.default("personal"),
    triggerType: triggerTypeSchema,
    body: z.string().min(1),
    enabled: z.boolean().optional(),
    event: z.string().min(1).optional(),
    schedule: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    condition: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    mcpTools: mcpToolsSchema.optional(),
  }),
  z.object({
    operation: z.literal("update"),
    name: z.string().min(1),
    scope: scopeSchema.default("personal"),
    ...automationFieldsSchema,
  }),
  z.object({
    operation: z.literal("delete"),
    name: z.string().min(1),
    scope: scopeSchema.default("personal"),
  }),
]);

export default defineAction({
  description:
    "Create, update, or delete a personal or organization automation from the Agent Automations page.",
  agentTool: false,
  schema,
  run: async (input, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const actor = { userEmail, orgId: ctx?.orgId };

    if (input.operation === "delete") {
      await deleteAutomation(actor, input.scope, input.name);
      await refreshEventSubscriptions();
      return { deleted: true, name: input.name };
    }

    if (input.operation === "create") {
      const definition = await defineAutomation(actor, {
        name: input.name,
        scope: input.scope,
        triggerType: input.triggerType,
        body: input.body,
        enabled: input.enabled,
        event: input.event,
        schedule: input.schedule,
        timezone: input.timezone,
        condition: input.condition ?? undefined,
        model: input.model ?? undefined,
        mcpTools: input.mcpTools,
      });
      await refreshEventSubscriptions();
      return {
        created: true,
        name: definition.name,
        scope: definition.scope,
        triggerType: definition.meta.triggerType,
        event: definition.meta.event ?? null,
        schedule: definition.meta.schedule || null,
        timezone: definition.meta.timezone ?? null,
        condition: definition.meta.condition ?? null,
        body: definition.body,
        enabled: definition.meta.enabled,
        nextRun: definition.meta.nextRun ?? null,
        createdBy: definition.meta.createdBy ?? null,
        model: definition.meta.model ?? null,
        mcpTools: definition.meta.mcpTools ?? [],
      };
    }

    const hasUpdate = Object.keys(automationFieldsSchema).some(
      (field) => input[field as keyof typeof input] !== undefined,
    );
    if (!hasUpdate) {
      throw Object.assign(new Error("At least one update field is required."), {
        statusCode: 400,
      });
    }
    const definition = await updateAutomation(actor, {
      name: input.name,
      scope: input.scope,
      triggerType: input.triggerType,
      enabled: input.enabled,
      event: input.event,
      schedule: input.schedule,
      timezone: input.timezone,
      condition: input.condition,
      body: input.body,
      model: input.model,
      mcpTools: input.mcpTools,
    });
    await refreshEventSubscriptions();
    return {
      updated: true,
      name: definition.name,
      scope: definition.scope,
      triggerType: definition.meta.triggerType,
      event: definition.meta.event ?? null,
      schedule: definition.meta.schedule || null,
      timezone: definition.meta.timezone ?? null,
      condition: definition.meta.condition ?? null,
      body: definition.body,
      enabled: definition.meta.enabled,
      nextRun: definition.meta.nextRun ?? null,
      createdBy: definition.meta.createdBy ?? null,
      model: definition.meta.model ?? null,
      mcpTools: definition.meta.mcpTools ?? [],
    };
  },
});
