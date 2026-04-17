import { createAuthPlugin } from "@agent-native/core/server";

// Clips has public share pages, embeds, and view-event tracking that must
// reach unauthenticated viewers. Everything else sits behind auth.
export default createAuthPlugin({
  publicPaths: [
    "/share",
    "/embed",
    "/api/view-event",
    "/api/public-recording",
    "/api/media",
  ],
});
