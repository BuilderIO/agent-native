import { createAuthPlugin } from "@agent-native/core/server";

// Calls has public share pages, embeds, and view-event tracking that must
// reach unauthenticated viewers. Everything else sits behind auth.
export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Calls",
    tagline:
      "Your AI agent transcribes, summarizes, and surfaces key moments from every conversation.",
    features: [
      "Automatic recaps, action items, and next steps after every call",
      "Smart trackers that detect competitor mentions, objections, and custom topics",
      "Shareable snippets — clip and send the exact moment that matters",
    ],
  },
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
