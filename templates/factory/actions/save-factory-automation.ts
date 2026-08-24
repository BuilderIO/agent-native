import { defineAction } from "@agent-native/core/action";
import { isValidCron, nextOccurrence } from "@agent-native/core/jobs";
import {
  resourceGetByPath,
  resourcePutIfCurrent,
} from "@agent-native/core/resources";
import { listAutomationDefinitions } from "@agent-native/core/triggers";
import { z } from "zod";

import {
  factoryIdSchema,
  patchAutomationResource,
  readAutomationEnabled,
  readAutomationFactoryId,
  readAutomationModel,
  readAutomationSchedule,
  resolveAutomationDisplayName,
  setAutomationFrontmatterField,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Edit a Factory automation's display name, prompt, model, schedule, or enabled state in its organization-owned markdown resource.",
  agentTool: false,
  schema: z.object({
    factoryId: factoryIdSchema,
    automationId: z.string().trim().min(1),
    name: z.string().trim().min(1).max(120),
    displayName: z.string().trim().max(120).optional(),
    prompt: z.string().trim().min(1).max(20_000),
    model: z.string().trim().max(200).optional(),
    schedule: z.string().trim().min(1).max(100),
    enabled: z.boolean(),
  }),
  http: { method: "POST" },
  run: async (
    {
      factoryId,
      automationId,
      name,
      displayName,
      prompt,
      model,
      schedule,
      enabled,
    },
    context,
  ) => {
    const { userEmail, orgId } = await requireWorkspaceMember(
      workspaceMemberIdentityFromContext(context),
    );
    const definitions = await listAutomationDefinitions(
      { userEmail, orgId, appId: "factory" },
      "organization",
    );
    const definition = definitions.find(
      (entry) =>
        entry.meta.domain === "factory" && entry.resource.id === automationId,
    );
    if (!definition) throw new Error("Factory automation not found.");
    if (
      readAutomationFactoryId(
        definition.meta,
        definition.resource.content,
        definition.resource.path,
      ) !== factoryId
    ) {
      throw new Error("Factory automation not found.");
    }
    if (definition.name !== name) {
      throw new Error(
        "Factory automation id and name do not refer to the same automation.",
      );
    }
    if (!definition.canUpdate) {
      throw new Error(
        "Only the automation's creator or an organization admin can update it.",
      );
    }
    if (definition.meta.triggerType === "schedule" && !isValidCron(schedule)) {
      throw new Error(`Invalid cron expression "${schedule}".`);
    }
    const resource = await resourceGetByPath(
      definition.resource.owner,
      definition.resource.path,
    );
    if (!resource) throw new Error("Factory automation not found.");
    let content = patchAutomationResource(resource.content, {
      body: prompt,
      enabled,
      schedule,
      model: model?.trim() || null,
      ...(displayName !== undefined ? { displayName } : {}),
    });
    content = setAutomationFrontmatterField(content, "factoryId", factoryId);
    if (definition.meta.triggerType === "schedule" && isValidCron(schedule)) {
      const nextRun = nextOccurrence(
        schedule,
        undefined,
        definition.meta.timezone,
      ).toISOString();
      content = setAutomationFrontmatterField(content, "nextRun", nextRun);
    }
    const updated = await resourcePutIfCurrent({
      owner: definition.resource.owner,
      path: definition.resource.path,
      content,
      mimeType: "text/markdown",
      expectedId: resource.id,
      expectedUpdatedAt: resource.updatedAt,
      expectedContent: resource.content,
    });
    if (!updated) {
      throw new Error(
        "Factory automation changed concurrently. Refresh and try again.",
      );
    }
    return {
      ok: true,
      id: definition.resource.id,
      name: definition.name,
      displayName: resolveAutomationDisplayName(definition.name, content),
      prompt,
      model: readAutomationModel(content),
      schedule: readAutomationSchedule(content),
      enabled: readAutomationEnabled(content),
    };
  },
});
