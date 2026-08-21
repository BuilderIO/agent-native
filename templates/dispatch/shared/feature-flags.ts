import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags";
import {
  DISPATCH_WORKSPACE_APP_LIST_FLAG,
  DISPATCH_WORKSPACE_SSO_FLAG,
} from "@agent-native/dispatch/shared/feature-flags";

export { DISPATCH_WORKSPACE_APP_LIST_FLAG, DISPATCH_WORKSPACE_SSO_FLAG };

export const DESKTOP_WORKSPACE_SSO_FLAG = defineFeatureFlag({
  key: "desktop.workspace-sso",
  displayName: "Desktop workspace sign-in",
  description:
    "Let the signed Agent Native Desktop broker workspace identity across first-party apps.",
});

export const DISPATCH_FEATURE_FLAGS = defineFeatureFlags([
  DESKTOP_WORKSPACE_SSO_FLAG,
  DISPATCH_WORKSPACE_SSO_FLAG,
  DISPATCH_WORKSPACE_APP_LIST_FLAG,
]);
