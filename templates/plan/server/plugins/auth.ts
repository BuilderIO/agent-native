import { createAuthPlugin } from "@agent-native/core/server";

import { PLAN_AGENT_CONTEXT_ENDPOINT } from "../../shared/agent-readable.js";
import { isLocalPlanRuntime } from "../lib/local-identity.js";
import { PUBLIC_PLAN_ACTION_PATHS } from "../lib/public-action-paths.js";

const LOCAL_MODE_ACTION_PATHS: string[] = isLocalPlanRuntime()
  ? [
      "/_agent-native/actions/create-visual-plan",
      "/_agent-native/actions/create-ui-plan",
      "/_agent-native/actions/create-prototype-plan",
      "/_agent-native/actions/create-plan-design",
      "/_agent-native/actions/create-visual-questions",
      "/_agent-native/actions/create-visual-recap",
      "/_agent-native/actions/visual-answer",
      "/_agent-native/actions/show-visual-plan",
      "/_agent-native/actions/visualize-plan",
      "/_agent-native/actions/convert-visual-plan-to-prototype",
      "/_agent-native/actions/import-visual-plan-source",
      "/_agent-native/actions/restore-plan-version",
      "/_agent-native/actions/list-visual-plans",
      "/_agent-native/actions/search-pr-recaps",
      "/_agent-native/actions/list-plan-components",
      "/_agent-native/actions/get-local-plan-folder",
      "/_agent-native/actions/update-local-plan-folder",
      "/_agent-native/actions/promote-local-plan-folder",
      "/_agent-native/actions/navigate",
      "/_agent-native/actions/view-screen",
    ]
  : [];

const PUBLIC_AGENT_CHAT_PATHS = ["/_agent-native/agent-chat"];

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  workspaceAppPublicPaths: [
    "/",
    "/chat",
    "/plans",
    "/plans/plan_",
    "/recaps",
    "/local-plans",
  ],
  publicPaths: [
    // Agent-readable context link: fetched with no session cookie, so the
    // gate must not 401 before the handler verifies its scoped token.
    PLAN_AGENT_CONTEXT_ENDPOINT,
    ...PUBLIC_PLAN_ACTION_PATHS,
    ...LOCAL_MODE_ACTION_PATHS,
    ...PUBLIC_AGENT_CHAT_PATHS,
  ],
  marketing: {
    appName: "Plan",
    learnMoreUrl: "https://agent-native.com/apps/plan",
    tagline:
      "Turn coding-agent plans into visual, annotatable HTML before code changes happen.",
    features: [
      "Create diagrams, wireframes, mockups, and prototype options from one prompt",
      "Annotate plans like a visual review surface instead of reading long Markdown",
      "Share account-backed review links when a plan needs outside feedback",
    ],
  },
});
