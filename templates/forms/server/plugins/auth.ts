import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  publicPaths: ["/f", "/api/forms/public", "/api/submit"],
});
