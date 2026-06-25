import { createAuthPlugin } from "@agent-native/core/server";

import { isLocalPlanRuntime } from "../lib/local-identity.js";
import { PUBLIC_PLAN_ACTION_PATHS } from "../lib/public-action-paths.js";

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

// The agent chat surface is reachable without an app session so a signed-out
// visitor can use the agent on a PUBLIC plan, the same way the docs site lets
// anyone chat without logging in. This only lets the request past the auth
// middleware — the real gate stays inside the agent-chat plugin's
// resolveOwnerContext, which resolves the stable anonymous public-plan viewer
// via resolvePlanAnonymousOwner (read-only by default) and still returns 401
// for any request that is not scoped to a public plan. The single base path
// prefix-matches every /_agent-native/agent-chat/* sub-route (threads, runs,
// mode, files, skills, …).
const PUBLIC_AGENT_CHAT_PATHS = ["/_agent-native/agent-chat"];

export default createAuthPlugin({
  workspaceAppAudience: "internal",
  // Public review links can load without a session. Plan creation stays behind
  // auth so the UI does not create placeholder plans for signed-out visitors.
  workspaceAppPublicPaths: [
    "/",
    "/plans",
    "/plans/plan_",
    "/recaps",
    "/local-plans",
  ],
  publicPaths: [
    ...PUBLIC_PLAN_ACTION_PATHS,
    ...LOCAL_MODE_ACTION_PATHS,
    ...PUBLIC_AGENT_CHAT_PATHS,
  ],
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
