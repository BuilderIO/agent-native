import { createAuthPlugin } from "@agent-native/core/server";

import { DECK_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable.js";

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Slides",
    screenshotPath: "/auth-marketing/slides.webp",
    screenshotWidth: 914,
    screenshotHeight: 818,
    learnMoreUrl: "https://agent-native.com/apps/slides",
    tagline:
      "Your AI agent builds, edits, and refines presentations alongside you.",
    features: [
      "Generate entire decks from a single prompt",
      "Surgical slide edits while you present or review",
      "Real-time collaboration between you and the agent",
    ],
  },
  publicPaths: [
    // Agent-readable context link: fetched with no session cookie, so the
    // gate must not 401 before the handler verifies its scoped token.
    DECK_AGENT_CONTEXT_ENDPOINT,
    "/share",
    "/p",
    "/api/share",
    // The handler still requires either a session or a live share token.
    "/api/image-proxy",
    "/_agent-native/google-docs/callback",
    // React Router's lazy route-discovery endpoint must stay public so
    // unauthenticated viewers can open shared presentation links directly.
    "/__manifest",
  ],
});
