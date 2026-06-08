import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import actionsRegistry from "../../.generated/actions-registry.js";
import { resolvePlanAnonymousOwner } from "../lib/public-plans.js";

export default createAgentChatPlugin({
  appId: "plan",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  anonymousOwner: resolvePlanAnonymousOwner,
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
});
