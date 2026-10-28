---
"@agent-native/core": minor
"@agent-native/dispatch": minor
---

Builder Workspaces support. Core adds `createBuilderWorkspaceApp` / `listBuilderWorkspaceApps` / `getBuilderWorkspaceProjectId`, an opt-in preview step (`WORKSPACE_PREVIEW_JOIN_ORG=1`, development + `AUTH_DISABLED` only) that adds the dev account to the workspace org, a `guard:workspace-app-scope` script in the workspace template, and Builder-compatible app id validation in `add-app`. When `BUILDER_WORKSPACE_PROJECT_ID` is set, Dispatch creates apps through Builder and reads pending apps from Builder instead of recording its own.
