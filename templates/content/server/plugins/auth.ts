import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Content",
    tagline:
      "Your AI agent creates, edits, and organizes documents alongside you in a Notion-like workspace.",
    features: [
      "Create and restructure entire document trees from a single prompt",
      "Surgical edits that sync live to your editor via real-time collaboration",
      "Search, summarize, and cross-reference documents instantly",
    ],
  },
  publicPaths: [
    "/api/pages/public",
    "/p",
    "/_agent-native/agent-chat",
    "/_agent-native/agent-engine/status",
    "/_agent-native/builder/callback",
    "/_agent-native/builder/connect",
    "/_agent-native/builder/status",
    "/_agent-native/env-status",
  ],
});
