import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Slides",
    tagline:
      "Your AI agent builds, edits, and refines presentations alongside you.",
    features: [
      "Generate entire decks from a single prompt",
      "Surgical slide edits while you present or review",
      "Real-time collaboration between you and the agent",
    ],
  },
  publicPaths: [
    "/share",
    "/api/share",
    "/_agent-native/google-docs/callback",
    // React Router's lazy route-discovery endpoint must stay public so
    // unauthenticated viewers can open shared presentation links directly.
    "/__manifest",
  ],
});
