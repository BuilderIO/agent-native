import { defineFeatureFlag } from "@agent-native/core/feature-flags";

/**
 * Browser-only rollout for app-scoped sessions in Dispatch panes. The server
 * action checks this flag too; the client hook only selects the presentation
 * path and keeps the legacy embed route available while the flag is off.
 */
export const DISPATCH_WORKSPACE_SSO_FLAG = defineFeatureFlag({
  key: "dispatch.workspace-sso",
  displayName: "Dispatch workspace sign-in",
  description:
    "Let Dispatch use the signed-in workspace identity for exact registered app panes.",
});
