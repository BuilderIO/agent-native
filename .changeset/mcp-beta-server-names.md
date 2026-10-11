---
"@agent-native/core": patch
---

Beta apps that do not declare `app.id` now name their MCP server after the app, such as `beta-agent-native-content`, instead of all sharing `beta-agent-native-beta`. Deployed functions run without `npm_package_name`, so the name comes from the hostname, and the leading `beta.` of a `beta.<app>.agent-native.com` host named the lane rather than the app. The connect page's app name changes the same way.
