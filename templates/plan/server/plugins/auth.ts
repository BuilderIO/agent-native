import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  // Guest authors can create/list/edit their own plans without signing in.
  // Generated public review links still resolve data through the public-plan
  // owner gate.
  workspaceAppPublicPaths: ["/", "/plans", "/plans/plan_"],
  publicPaths: [
    "/_agent-native/actions/get-visual-plan",
    "/_agent-native/actions/update-visual-plan",
    "/_agent-native/actions/export-visual-plan",
  ],
  marketing: {
    appName: "Agent-Native Plans",
    tagline:
      "Turn coding-agent plans into visual, annotatable HTML before code changes happen.",
    features: [
      "Create diagrams, wireframes, mockups, and prototype options from one prompt",
      "Annotate plans like a visual review surface instead of reading long Markdown",
      "Share account-backed review links when a plan needs outside feedback",
    ],
  },
});
