import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";

export default createAgentChatPlugin({
  appId: "starter",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
});
