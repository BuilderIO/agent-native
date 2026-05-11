import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import actionsRegistry from "../../.generated/actions-registry.js";

export default createAgentChatPlugin({
  appId: "scheduling",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
});
