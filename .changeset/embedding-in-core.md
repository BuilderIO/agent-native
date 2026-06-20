---
"@agent-native/core": minor
---

Add an `@agent-native/core/embedding` export surface (`./embedding`,
`./embedding/react`, `./embedding/bridge`, `./embedding/agent`,
`./embedding/protocol`) that hosts the `EmbeddedApp` component and embed bridge.

The implementation moved here from the workspace-only `@agent-native/embedding`
package, which is not published to npm. Standalone scaffolds of templates that
embed apps (content, design, assets) previously rewrote their `workspace:*`
dependency on `@agent-native/embedding` to `latest`, which 404'd on install
because the package isn't published. Those templates now import the embed
surface from the published `@agent-native/core` instead, so
`create --standalone --template content` installs cleanly. The
`@agent-native/embedding` package remains as a thin re-export for backward
compatibility.
