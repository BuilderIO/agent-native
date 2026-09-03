import { defineAction } from "@agent-native/core/action";
import {
  listAutomationDefinitions,
  queueAutomationRunNow,
} from "@agent-native/core/triggers";
import { z } from "zod";

import {
  factoryIdSchema,
  readAutomationFactoryId,
} from "../server/lib/factory-scope.js";
import {
  requireWorkspaceMember,
  workspaceMemberIdentityFromContext,
} from "../server/lib/require-workspace-member.js";

export default defineAction({
  description:
    "Queue one organization-scoped Factory automation for an immediate run and return its durable run id.",
  agentTool: false,
  schema: z.object({
    factoryId: factoryIdSchema,
    automationId: z.string().trim().min(1),
  }),
  http: { method: "POST" },
  run: async ({ factoryId, automationId }, context) => {
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
    return queueAutomationRunNow({
      userEmail,
      orgId,
      appId: "factory",
      scope: "organization",
      path: definition.resource.path,
      requestHeaders: context?.requestHeaders,
    });
  },
});
