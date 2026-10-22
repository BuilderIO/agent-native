import { defineAction, fail } from "@agent-native/core/action";
import { queueAutomationRunNow } from "@agent-native/core/triggers";
import { z } from "zod";

import { findFactoryAutomationDefinition } from "../server/lib/factory-automation-resources.js";
import { factoryIdSchema } from "../server/lib/factory-scope.js";
import {
  isWorkflowJob,
  workflowJobRefusal,
} from "../server/lib/factory-workflow-runner.js";
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
    const definition = await findFactoryAutomationDefinition(
      orgId,
      factoryId,
      automationId,
    );
    if (!definition) throw new Error("Factory automation not found.");
    if (isWorkflowJob(definition.meta)) {
      const { message, errorCode } = workflowJobRefusal("run");
      fail(message, { errorCode, statusCode: 409 });
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
