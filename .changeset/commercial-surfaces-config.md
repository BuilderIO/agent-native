---
"@agent-native/core": minor
"@agent-native/toolkit": minor
"@agent-native/dispatch": patch
---

Add `billing.commercialSurfaces` to `agent-native.json` (env `AGENT_NATIVE_CONFIG_BILLING_COMMERCIAL_SURFACES`). It defaults to `"show"`, which changes nothing. `"hide"` removes credit units and amounts, plan upgrades, free-credit offers and referral rewards: usage reads as dollars and tokens, credit alerts can't be created, the credit notice and run-details credits row are left out, a credits-limit error offers only Retry, and the Builder connect popover drops the free-credit pitch. `commercialSurfacesHidden()` (from `@agent-native/core/client/app-config`) and `deploymentUsageBilling()` let an app follow the same setting, and `AgentKitRoot` takes `showRunCredits`. With `notifications.usageLimitNotices: false`, usage-limit alerts are no longer evaluated or sent on any channel.
