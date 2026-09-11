import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  defineAutomation,
  deleteAutomation,
  updateAutomation,
} from "../../automations/service.js";
import { refreshEventSubscriptions } from "../dispatcher.js";

export default defineAction({
  description:
    "Create, enable, disable, or delete a personal or organization automation from the Agent Automations page.",
  agentTool: false,
  schema: z.object({
    operation: z.enum(["create", "update", "delete"]),
    name: z.string().min(1),
    scope: z.enum(["personal", "organization"]).default("personal"),
    triggerType: z.enum(["schedule", "event", "webhook"]).optional(),
    body: z.string().optional(),
    event: z.string().min(1).optional(),
    enabled: z.boolean().optional(),
    schedule: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
    executionHostId: z.string().min(1).nullable().optional(),
    executionEngine: z.string().min(1).nullable().optional(),
    executionCwd: z.string().min(1).nullable().optional(),
  }),
  run: async (
    {
      operation,
      name,
      scope,
      triggerType,
      body,
      event,
      enabled,
      schedule,
      timezone,
      executionHostId,
      executionEngine,
      executionCwd,
    },
    ctx,
  ) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const actor = {
      userEmail,
      orgId: ctx?.orgId,
      appId: ctx?.appId,
    };

    if (operation === "create") {
      if (!triggerType) {
        throw Object.assign(new Error("triggerType is required for create."), {
          statusCode: 400,
        });
      }
      const definition = await defineAutomation(actor, {
        name,
        scope,
        triggerType,
        body: body ?? "",
        event,
        schedule,
        timezone,
      });
      await refreshEventSubscriptions();
      return {
        created: true,
        name: definition.name,
        scope,
        triggerType: definition.meta.triggerType,
        event: definition.meta.event ?? null,
        schedule: definition.meta.schedule || null,
        timezone: definition.meta.timezone ?? null,
        webhookPath: definition.webhookPath ?? null,
        nextRun: definition.meta.nextRun ?? null,
      };
    }

    if (operation === "delete") {
      await deleteAutomation(actor, scope, name);
      await refreshEventSubscriptions();
      return { deleted: true, name };
    }
    if (
      enabled === undefined &&
      schedule === undefined &&
      timezone === undefined &&
      executionHostId === undefined &&
      executionEngine === undefined &&
      executionCwd === undefined
    ) {
      throw Object.assign(
        new Error("enabled, schedule, or timezone is required for update."),
        { statusCode: 400 },
      );
    }
    const definition = await updateAutomation(actor, {
      name,
      scope,
      ...(enabled === undefined ? {} : { enabled }),
      ...(schedule === undefined ? {} : { schedule }),
      ...(timezone === undefined ? {} : { timezone }),
      ...(executionHostId === undefined ? {} : { executionHostId }),
      ...(executionEngine === undefined ? {} : { executionEngine }),
      ...(executionCwd === undefined ? {} : { executionCwd }),
    });
    await refreshEventSubscriptions();
    return {
      name,
      enabled: definition.meta.enabled,
      schedule: definition.meta.schedule || null,
      timezone: definition.meta.timezone ?? null,
      executionHostId: definition.meta.executionHostId ?? null,
      executionEngine: definition.meta.executionEngine ?? null,
      executionCwd: definition.meta.executionCwd ?? null,
      nextRun: definition.meta.nextRun ?? null,
      webhookPath: definition.webhookPath ?? null,
    };
  },
});
