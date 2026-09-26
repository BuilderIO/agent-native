import {
  CONNECT_APPS_FLAG,
  defineFeatureFlag,
} from "@agent-native/core/feature-flags/registry";

export const DISPATCH_WORKSPACE_SSO_FLAG = defineFeatureFlag({
  key: "dispatch.workspace-sso",
  displayName: "Dispatch workspace sign-in",
  description:
    "Let Dispatch use the signed-in workspace identity for exact registered app panes.",
});

export const DISPATCH_WORKSPACE_APP_LIST_FLAG = defineFeatureFlag({
  key: "dispatch.workspace-app-list",
  displayName: "Workspace app list",
  description:
    "Show apps from the signed-in workspace in native desktop and mobile app lists.",
});

export const DISPATCH_CONNECT_APPS_FLAG = CONNECT_APPS_FLAG;
