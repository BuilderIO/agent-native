import { defineAction } from "@agent-native/core/action";
import {
  listAutomationDefinitions,
  updateAutomation,
} from "@agent-native/core/triggers";
import { z } from "zod";

import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Edit a Factory automation's prompt, model, schedule, or enabled state in its organization-owned markdown resource.",
  agentTool: false,
  schema: z.object({
    factoryId: z.string().trim().min(1).optional(),
    automationId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().min(1).max(20_000),
    model: z.string().trim().max(200).optional(),
    schedule: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
  }),
  http: { method: "POST" },
  run: async (
    { automationId, name, prompt, model, schedule, enabled },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const definitions = await listAutomationDefinitions(
      { userEmail, orgId },
      "organization",
    );
    const definition = definitions.find(
      (entry) =>
        entry.meta.domain === "factory" &&
        (entry.resource.id === automationId || entry.name === name),
    );
    if (!definition) throw new Error("Factory automation not found.");
    const updated = await updateAutomation(
      { userEmail, orgId },
      {
        name: definition.name,
        scope: "organization",
        body: prompt,
        model: model?.trim() || null,
        schedule,
        enabled,
      },
    );
    return {
      ok: true,
      id: definition.resource.id,
      name: updated.name,
      prompt: updated.body,
      model: updated.meta.model ?? null,
      schedule: updated.meta.schedule || null,
      enabled: updated.meta.enabled,
    };
  },
});
