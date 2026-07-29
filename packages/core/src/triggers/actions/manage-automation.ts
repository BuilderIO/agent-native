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
  }),
  run: async ({ operation, name, scope, enabled }, ctx) => {
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Not authenticated.");
    const actor = { userEmail, orgId: ctx?.orgId };

    if (operation === "delete") {
      await deleteAutomation(actor, scope, name);
      await refreshEventSubscriptions();
      return { deleted: true, name };
    }
    if (enabled === undefined) {
      throw Object.assign(new Error("enabled is required for update."), {
        statusCode: 400,
      });
    }
    const definition = await updateAutomation(actor, {
      name,
      scope,
      enabled,
    });
    await refreshEventSubscriptions();
    return {
      name,
      enabled: definition.meta.enabled,
      nextRun: definition.meta.nextRun ?? null,
    };
  },
});
