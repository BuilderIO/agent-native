import { createAuthPlugin } from "@agent-native/core/server";

import { DESIGN_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable.js";

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  workspaceAppPublicPaths: ["/", "/visual-edit", "/design", "/present"],
  marketing: {
    appName: "Design",
    learnMoreUrl: "https://agent-native.com/apps/design",
    tagline:
      "Design and prototype by describing what you want. The AI agent turns your ideas into interactive, fully responsive designs in seconds.",
    features: [
      "Create polished prototypes just by describing them",
      "Build and apply design systems to keep everything on-brand",
      "Export your work or share it with a link",
    ],
  },
  publicPaths: [
    "/api/design-handoff",
    // gate must not 401 before the handler verifies its scoped token.
    DESIGN_AGENT_CONTEXT_ENDPOINT,
    "/__manifest",
    "/_agent-native/actions/get-design",
    "/_agent-native/actions/get-design-access-status",
    "/_agent-native/actions/list-design-native-assets",
    "/_agent-native/actions/list-review-comments",
  ],
});
