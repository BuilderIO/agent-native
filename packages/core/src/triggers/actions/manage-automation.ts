import { z } from "zod";

import { defineAction } from "../../action.js";
import {
  deleteAutomation,
  updateAutomation,
} from "../../automations/service.js";
import { refreshEventSubscriptions } from "../dispatcher.js";

export default defineAction({
  description:
    "Enable, disable, or delete a personal or organization automation from the Agent Automations page.",
  agentTool: false,
  schema: z.object({
    operation: z.enum(["update", "delete"]),
    name: z.string().min(1),
    scope: z.enum(["personal", "organization"]).default("personal"),
    enabled: z.boolean().optional(),
    schedule: z.string().min(1).optional(),
    timezone: z.string().min(1).optional(),
  }),
  run: async ({ operation, name, scope, enabled, schedule, timezone }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const actor = {
      userEmail,
      orgId: ctx?.orgId,
      appId: ctx?.appId,
    };

    if (operation === "delete") {
      await deleteAutomation(actor, scope, name);
      await refreshEventSubscriptions();
      return { deleted: true, name };
    }
    if (
      enabled === undefined &&
      schedule === undefined &&
      timezone === undefined
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
    });
    await refreshEventSubscriptions();
    return {
      name,
      enabled: definition.meta.enabled,
      schedule: definition.meta.schedule || null,
      timezone: definition.meta.timezone ?? null,
      nextRun: definition.meta.nextRun ?? null,
    };
  },
});
