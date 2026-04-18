import { createAuthPlugin } from "@agent-native/core/server";

// Calls has public share pages, embeds, and view-event tracking that must
// reach unauthenticated viewers. Everything else sits behind auth.
export default createAuthPlugin({
  publicPaths: [
    "/share",
    "/share-snippet",
    "/embed",
    "/embed-snippet",
    "/api/view-events",
    "/api/public-call",
    "/api/public-snippet",
    "/api/call-media",
    "/api/call-thumbnail",
    "/api/snippet-media",
    // Third-party webhooks authenticate via signatures, not session cookies.
    "/api/webhooks",
    "/api/oauth",
  ],
});
