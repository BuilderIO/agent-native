import { createAgentChatPlugin } from "@agent-native/core/server";
import { actionRegistry, systemPrompt } from "../../actions/registry.js";

export default createAgentChatPlugin({
  appId: "issues",
  actions: async () => actionRegistry,
  systemPrompt,
});
