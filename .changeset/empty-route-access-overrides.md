---
"@agent-native/core": patch
---

`workspaceAppRouteAccessFromPackageJson` now returns optional `publicPaths` / `protectedPaths` so consumers can distinguish "field absent" from "field explicitly empty." `workspace-deploy`, `workspace-dev`, and `agent-discovery` prefer the package.json value whenever it was set (even `[]`), so an app owner can clear an inherited manifest override by writing `"publicPaths": []` in its `package.json`.
