---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Start a signed-in visitor's early session read from the top of `<head>`, before the page's stylesheets and module preloads, instead of from the body after them, where it waited for every stylesheet to load. `AppProviders` reports the read during the server render, so pages that skip the session check still start none.

Toolkit now requires `@agent-native/core` 0.205.0 or later, the first release that exports `@agent-native/core/shared/ssr-session-bootstrap-slot` and `@agent-native/core/shared/mcp-app-widget-embed`, which `AppProviders` imports.
