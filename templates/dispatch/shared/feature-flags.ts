import {
  defineFeatureFlag,
  defineFeatureFlags,
} from "@agent-native/core/feature-flags/registry";
import {
  DISPATCH_WORKSPACE_APP_LIST_FLAG,
  DISPATCH_WORKSPACE_SSO_FLAG,
} from "@agent-native/dispatch/shared/feature-flags";

export { DISPATCH_WORKSPACE_APP_LIST_FLAG, DISPATCH_WORKSPACE_SSO_FLAG };

export const BROWSER_IDENTITY_SSO_FLAG = defineFeatureFlag({
  key: "browser.identity-sso",
  displayName: "Browser identity sign-in",
  description:
    "Silently reuse an existing Agent-Native session when a canonical app sign-in page opens.",
});

export const DESKTOP_WORKSPACE_SSO_FLAG = defineFeatureFlag({
  key: "desktop.workspace-sso",
  displayName: "Desktop workspace sign-in",
  description:
    "Let the signed Agent-Native Desktop broker workspace identity across first-party apps.",
});

export const DISPATCH_FEATURE_FLAGS = defineFeatureFlags([
  BROWSER_IDENTITY_SSO_FLAG,
  DESKTOP_WORKSPACE_SSO_FLAG,
  DISPATCH_WORKSPACE_SSO_FLAG,
  DISPATCH_WORKSPACE_APP_LIST_FLAG,
]);
