import {
  createAgentChatPlugin,
  autoDiscoverActions,
} from "@agent-native/core/server";
import { getOrgContext } from "@agent-native/core/org";

export default createAgentChatPlugin({
  actions: () => autoDiscoverActions(import.meta.url),
  resolveOrgId: async (event) => {
    const ctx = await getOrgContext(event);
    return ctx.orgId;
  },
});
