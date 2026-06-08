import { createAuthPlugin } from "@agent-native/core/server";
import { PUBLIC_PLAN_ACTION_PATHS } from "../lib/public-action-paths.js";
import { isLocalPlanRuntime } from "../lib/local-identity.js";

// In local dev mode, all plan action paths are open. The action handlers gate
// ownership via requirePlanOwnerEmailForWrite (returns the local identity) so
// there is no security gap; isLocalPlanRuntime() is always false in production.
const LOCAL_MODE_ACTION_PATHS: string[] = isLocalPlanRuntime()
  ? [
      "/_agent-native/actions/create-visual-plan",
      "/_agent-native/actions/create-ui-plan",
      "/_agent-native/actions/create-prototype-plan",
      "/_agent-native/actions/create-plan-design",
      "/_agent-native/actions/create-visual-questions",
      "/_agent-native/actions/create-visual-recap",
      "/_agent-native/actions/visualize-plan",
      "/_agent-native/actions/convert-visual-plan-to-prototype",
      "/_agent-native/actions/import-visual-plan-source",
      "/_agent-native/actions/restore-plan-version",
      "/_agent-native/actions/list-visual-plans",
      "/_agent-native/actions/navigate",
      "/_agent-native/actions/view-screen",
    ]
  : [];

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  // Public review links can load without a session. Plan creation stays behind
  // auth so the UI does not create placeholder plans for signed-out visitors.
  workspaceAppPublicPaths: ["/", "/plans", "/plans/plan_"],
  publicPaths: [...PUBLIC_PLAN_ACTION_PATHS, ...LOCAL_MODE_ACTION_PATHS],
  marketing: {
    appName: "Agent-Native Plan",
    tagline:
      "Turn coding-agent plans into visual, annotatable HTML before code changes happen.",
    features: [
      "Create diagrams, wireframes, mockups, and prototype options from one prompt",
      "Annotate plans like a visual review surface instead of reading long Markdown",
      "Share account-backed review links when a plan needs outside feedback",
    ],
  },
});
