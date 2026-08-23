import { defineAction } from "@agent-native/core/action";
import {
  listAutomationDefinitions,
  listAutomationRuns,
} from "@agent-native/core/triggers";
import { z } from "zod";

import { readFactoryDefinition } from "../server/factory-graph/store.js";
import {
  DEFAULT_FACTORY_ID,
  factoryIdSchema,
  readAutomationFactoryId,
  resolveAutomationDisplayName,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

function automationRunHistoryKey(path: string): string {
  return path.replace(/^jobs\//, "").replace(/\.md$/, "");
}

export default defineAction({
  description:
    "List the organization-scoped Factory automations with their trigger, editable prompt, model, schedule, enabled state, and recent runs.",
  agentTool: false,
  schema: z.object({ factoryId: factoryIdSchema }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ factoryId }, context) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const factory = await readFactoryDefinition(orgId, factoryId);
    if (!factory && factoryId !== DEFAULT_FACTORY_ID) {
      throw new Error("Factory not found.");
    }
    const definitions = await listAutomationDefinitions(
      { userEmail, orgId, appId: "factory" },
      "organization",
    );
    const scoped = definitions.filter(
      ({ meta, resource }) =>
        meta.domain === "factory" &&
        readAutomationFactoryId(meta, resource.content, resource.path) ===
          factoryId,
    );
    return Promise.all(
      scoped.map(async ({ resource, name, meta, body, canUpdate }) => {
        const runs = await listAutomationRuns({
          owners: [resource.owner],
          automation: automationRunHistoryKey(resource.path),
          appId: "factory",
          limit: 20,
        });
        return {
          id: resource.id,
          name,
          displayName: resolveAutomationDisplayName(name, resource.content),
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
          runs: runs.filter((run) => run.path === resource.path),
        };
      }),
    );
  },
});
