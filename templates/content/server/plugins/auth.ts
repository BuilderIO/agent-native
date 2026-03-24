import { createGoogleAuthPlugin } from "@agent-native/core/server";

export default createGoogleAuthPlugin({
  publicPaths: ["/api/pages/public"],
});
