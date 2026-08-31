import type { ActionRunContext } from "@agent-native/core/action";
import { listAutomationDefinitions } from "@agent-native/core/triggers";

import {
  readFactoryAutomationConfig,
  type FactoryAutomationConfig,
} from "./factory-automation-config.js";
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
  const definition = (
    await listAutomationDefinitions(
      {
        userEmail: identity.userEmail,
        orgId: identity.orgId,
        appId: "factory",
      },
      "organization",
    )
  ).find((entry) => entry.resource.id === context.automation?.triggerId);
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
