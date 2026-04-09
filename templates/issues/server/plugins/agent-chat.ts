import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import { systemPrompt } from "../../actions/registry.js";

export default createAgentChatPlugin({
  appId: "issues",
  actions: () => autoDiscoverActions(import.meta.url),
  systemPrompt,
});
