---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Builder Workspaces support. When `BUILDER_WORKSPACE_PROJECT_ID` is set, the workspace's apps are built in Builder: Dispatch's create-app surfaces (the create-app popover, `/new-app`, Build app, community install and template remix) link to the workspace in Builder, and app-creation actions return a `builder-managed` result with that link instead of creating anything. Core adds `getBuilderWorkspaceProjectId` / `getBuilderWorkspaceUrl`, an opt-in preview step (`WORKSPACE_PREVIEW_JOIN_ORG=1`, development + `AUTH_DISABLED` only) that adds the dev account to the workspace org, a `guard:workspace-app-scope` script in the workspace template, and Builder-compatible app id validation in `add-app`.
