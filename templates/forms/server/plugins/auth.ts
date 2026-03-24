import { createGoogleAuthPlugin } from "@agent-native/core/server";

export default createGoogleAuthPlugin({
  publicPaths: ["/f", "/api/forms/public", "/api/submit"],
});
