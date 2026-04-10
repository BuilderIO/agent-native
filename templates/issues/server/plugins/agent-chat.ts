import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";
import { systemPrompt } from "../../actions/registry.js";

export default createAgentChatPlugin({
  appId: "issues",
  actions: () => autoDiscoverActions(import.meta.url),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
  systemPrompt,
});
