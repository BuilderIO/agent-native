import { createToolkitAuthPlugin } from "@agent-native/toolkit/app/auth/server";

import { DOCUMENT_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable.js";

export default createToolkitAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  marketing: {
    appName: "Content",
    learnMoreUrl:
      "https://agent-native.com/apps/content?utm_source=app&utm_medium=product&utm_content=onboarding-learn-more",
    tagline:
      "Open-source Obsidian for MDX: your AI agent edits local docs, creates custom blocks, and organizes everything alongside you.",
    features: [
      "Edit local Markdown/MDX files directly, with hosted sync when you need it",
      "Generate rich interactive custom MDX blocks and edit their props visually",
      "Search, summarize, cross-reference, and restructure document trees instantly",
    ],
  },
  publicPaths: [
    // Agent-readable context link: fetched with no session cookie, so the
    // gate must not 401 before the handler verifies its scoped token.
    DOCUMENT_AGENT_CONTEXT_ENDPOINT,
    // Binary image reads authorize each live document reference in the route.
    "/api/private-icons/",
    // Sessionless self-dispatch; this exact worker owns scoped-token auth.
    // Never expose the `_agent-native-background` namespace.
    "/api/_agent-native-background/content-trash-purge-worker",
    "/api/pages/public",
    "/p",
    "/_agent-native/agent-chat",
    "/_agent-native/agent-engine/status",
    "/_agent-native/builder/callback",
    "/_agent-native/builder/connect",
    "/_agent-native/builder/status",
    "/_agent-native/connection-status/builder",
    "/_agent-native/env-status",
  ],
});
