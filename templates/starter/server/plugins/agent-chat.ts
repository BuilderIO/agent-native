import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";

export default createAgentChatPlugin({
  actions: loadActionsFromStaticRegistry(actionsRegistry),
});
