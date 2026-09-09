import type { ActionRunContext } from "@agent-native/core/action";

import {
  readFactoryAutomationConfig,
  type FactoryAutomationConfig,
} from "./factory-automation-config.js";
import {
  factoryIdFromAutomationName,
  findFactoryAutomationDefinition,
} from "./factory-automation-resources.js";
import type { WorkspaceMemberIdentity } from "./require-workspace-member.js";

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
  if (!definition) return null;
  return {
    name: definition.name,
    content: definition.resource.content,
    config: readFactoryAutomationConfig(
      definition.resource.content,
      definition.name,
    ),
  };
}
