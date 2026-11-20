import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  publicPaths: ["/f", "/embed", "/_domains"],
  rootAuth: true,
  marketing: false,
});
