import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import { getOrgContext } from "@agent-native/core/org";
import { systemPrompt } from "../../actions/registry.js";

export default createAgentChatPlugin({
  appId: "issues",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt,
});
