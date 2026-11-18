---
"@agent-native/core": minor
"@agent-native/toolkit": minor
"@agent-native/dispatch": patch
---

Add `billing.commercialSurfaces` to `agent-native.json` (env `AGENT_NATIVE_CONFIG_BILLING_COMMERCIAL_SURFACES`). It defaults to `"show"`, which changes nothing. `"hide"` removes credit units and amounts, plan upgrades, free-credit offers and referral rewards: usage reads as dollars and tokens (a run reports its provider cost and no credits), existing credit alerts can't be listed, changed or delivered and new ones can't be created, stored credit-alert notices drop out of the inbox, the credit notice, credit-limit email and run-details credits row are left out, a credits-limit error offers only Retry in the card and the transcript, the referral action returns nothing, and the Builder connect popover, model picker and first-run setup drop the free-credit pitch. A composer host sets the Builder choice's caption with the `builder.creditsOffered` adapter. `commercialSurfacesHidden()` (from `@agent-native/core/client/app-config`) and `deploymentUsageBilling()` let an app follow the same setting, and `AgentKitRoot` takes `showRunCredits`. With `notifications.usageLimitNotices: false`, usage-limit alerts are no longer evaluated or sent on any channel.
