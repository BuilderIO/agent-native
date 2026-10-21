import type { ActionRunContext } from "@agent-native/core/action";

import { getWorkflowStore } from "../workflow-host/factory-store.js";
import {
  readFactoryAutomationConfig,
  type FactoryAutomationConfig,
} from "./factory-automation-config.js";
import {
  factoryIdFromAutomationName,
  findFactoryAutomationDefinition,
} from "./factory-automation-resources.js";
import type { WorkspaceMemberIdentity } from "./require-workspace-member.js";
import { failWorkflowAction } from "./workflow-action-errors.js";

/**
 * The calling job's file, or null when the caller is not a Factory job. A
 * caller that has a saved workflow but no job file is not "no job": callers
 * fall back to factory-level config on null, and a workflow must not be
 * widened to that, so it fails instead.
 */
export async function readCallingFactoryAutomation(
  context: ActionRunContext | undefined,
  identity: Pick<WorkspaceMemberIdentity, "userEmail" | "orgId">,
): Promise<{
  name: string;
  content: string;
  config: FactoryAutomationConfig;
} | null> {
  if (context?.caller !== "automation" || !context.automation) return null;
  const factoryId = factoryIdFromAutomationName(context.automation.triggerName);
  const definition = factoryId
    ? await findFactoryAutomationDefinition(
        identity.orgId,
        factoryId,
        context.automation.triggerId,
      )
    : null;
  if (!definition) {
    if (
      factoryId &&
      (await getWorkflowStore().getWorkflowByAutomation(
        { orgId: identity.orgId, factoryId },
        context.automation.triggerId,
      ))
    ) {
      failWorkflowAction({
        message: `${context.automation.triggerName} has a saved workflow but its job file could not be read, so it cannot use factory-level settings in its place.`,
        errorCode: "workflow_automation_unresolved",
        statusCode: 409,
        details: { automationId: context.automation.triggerId },
      });
    }
    return null;
  }
  return {
    name: definition.name,
    content: definition.resource.content,
    config: readFactoryAutomationConfig(
      definition.resource.content,
      definition.name,
    ),
  };
}
