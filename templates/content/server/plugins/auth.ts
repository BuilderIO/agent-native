import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  publicPaths: ["/api/pages/public"],
});
