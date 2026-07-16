import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  marketing: {
    appName: "Agent-Native Content",
    tagline:
      "Open-source Obsidian for MDX: your AI agent edits local docs, creates custom blocks, and organizes everything alongside you.",
    features: [
      "Edit local Markdown/MDX files directly, with hosted sync when you need it",
      "Generate rich interactive custom MDX blocks and edit their props visually",
      "Search, summarize, cross-reference, and restructure document trees instantly",
    ],
  },
  publicPaths: [
    "/api/pages/public",
    // The media handler performs its own uniform public/token/session access
    // decision. Keeping the outer guard out of this path lets it return the
    // same no-store 404 for unknown and inaccessible handles.
    "/api/document-media",
    "/p",
    "/_agent-native/actions/get-public-document",
    "/_agent-native/agent-chat",
    "/_agent-native/agent-engine/status",
    "/_agent-native/builder/callback",
    "/_agent-native/builder/connect",
    "/_agent-native/builder/status",
    "/_agent-native/connection-status/builder",
    "/_agent-native/env-status",
  ],
});
