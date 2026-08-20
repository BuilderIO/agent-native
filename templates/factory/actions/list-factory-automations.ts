import { defineAction } from "@agent-native/core/action";
import {
  listAutomationDefinitions,
  listAutomationRuns,
} from "@agent-native/core/triggers";
import { z } from "zod";

import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "List the organization-scoped Factory automations with their trigger, editable prompt, model, schedule, enabled state, and recent runs.",
  agentTool: false,
  schema: z.object({ factoryId: z.string().trim().min(1).optional() }),
  http: { method: "GET" },
  readOnly: true,
  run: async (_, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const definitions = await listAutomationDefinitions(
      { userEmail, orgId, appId: "factory" },
      "organization",
    );
    return Promise.all(
      definitions
        .filter(({ meta }) => meta.domain === "factory")
        .map(async ({ resource, name, meta, body, canUpdate }) => ({
          id: resource.id,
          name,
          prompt: body,
          body,
          model: meta.model ?? null,
          schedule: meta.schedule || null,
          enabled: meta.enabled,
          triggerType: meta.triggerType,
          event: meta.event ?? null,
          timezone: meta.timezone ?? null,
          condition: meta.condition ?? null,
          createdBy: meta.createdBy ?? null,
          updatedAt:
            Number.isFinite(resource.updatedAt) && resource.updatedAt > 0
              ? new Date(resource.updatedAt).toISOString()
              : null,
          canUpdate,
          runs: await listAutomationRuns({
            owners: [resource.owner],
            automation: name,
            appId: "factory",
            limit: 20,
          }),
        })),
    );
  },
});
