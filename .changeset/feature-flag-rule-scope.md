---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Feature flag changes now say which rule they change. A flag can have a rule for every organization and an organization's own rule, which replaces it; `set-feature-flag` takes `scope: "org" | "global"`, only emails on the app's feature flag admin list can change the rule for every organization (from inside any organization), and `list-feature-flags` reports both rules, which one is in effect, and any rule that couldn't be read. The flag editor names where a change applies and shows when an organization's own rule overrides the rule for all organizations.
