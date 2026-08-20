import { defineAction } from "@agent-native/core/action";
import {
  listAutomationDefinitions,
  listAutomationRuns,
} from "@agent-native/core/triggers";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { readFactoryDefinition } from "../server/factory-graph/store.js";
import { repairFactoryAutomationsFromConfig } from "../server/lib/factory-automation-repair.js";
import {
  DEFAULT_FACTORY_ID,
  factoryIdSchema,
  readAutomationFactoryId,
  readTriageConfigRow,
  resolveAutomationDisplayName,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

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
    let definitions = await listAutomationDefinitions(
      { userEmail, orgId, appId: "factory" },
      "organization",
    );
    let scoped = definitions.filter(
      ({ meta, resource }) =>
        meta.domain === "factory" &&
        readAutomationFactoryId(meta, resource.content) === factoryId,
    );
    if (scoped.length === 0) {
      const config = await readTriageConfigRow(getDb(), orgId, factoryId);
      if (config) {
        await repairFactoryAutomationsFromConfig(userEmail, orgId, factoryId);
        definitions = await listAutomationDefinitions(
          { userEmail, orgId, appId: "factory" },
          "organization",
        );
        scoped = definitions.filter(
          ({ meta, resource }) =>
            meta.domain === "factory" &&
            readAutomationFactoryId(meta, resource.content) === factoryId,
        );
      }
    }
    return Promise.all(
      scoped.map(async ({ resource, name, meta, body, canUpdate }) => ({
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
