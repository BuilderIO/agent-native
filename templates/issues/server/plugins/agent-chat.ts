import { createAgentChatPlugin } from "@agent-native/core/server";
import { scriptRegistry, systemPrompt } from "../../scripts/registry.js";

export default createAgentChatPlugin({
  scripts: async () => scriptRegistry,
  systemPrompt,
});
