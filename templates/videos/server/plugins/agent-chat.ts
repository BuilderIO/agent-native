import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";

export default createAgentChatPlugin({
  actions: () => autoDiscoverActions(import.meta.url),
  resolveOrgId: async (event) => (await getOrgContext(event)).orgId,
});
