import {
  createAgentChatPlugin,
  loadActionsFromStaticRegistry,
} from "@agent-native/core/server";
import actionsRegistry from "../../.generated/actions-registry.js";
import "../register-secrets.js";

export default createAgentChatPlugin({
  appId: "images",
  actions: loadActionsFromStaticRegistry(actionsRegistry),
  runSoftTimeoutMs: 240_000,
});
