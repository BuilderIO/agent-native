import "./register-secrets.js";
import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";

export default createAgentChatPlugin({
  actions: () => autoDiscoverActions(import.meta.url),
});
