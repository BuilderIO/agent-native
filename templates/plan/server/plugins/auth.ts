import { createAuthPlugin } from "@agent-native/core/server";
import { PUBLIC_PLAN_ACTION_PATHS } from "../lib/public-action-paths.js";

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  // Public review links can load without a session. Plan creation stays behind
  // auth so the UI does not create placeholder plans for signed-out visitors.
  workspaceAppPublicPaths: ["/", "/plans", "/plans/plan_"],
  publicPaths: [...PUBLIC_PLAN_ACTION_PATHS],
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
