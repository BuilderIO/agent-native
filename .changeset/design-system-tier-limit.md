---
"@agent-native/core": minor
---

Add `fetchBuilderDesignSystemTierLimit`, `designSystemTierUpgradeUrl`, `assertBuilderDesignSystemCodeIndexingAllowed`, and the `@agent-native/core/client/design-system-tier-limit` helpers so apps can show a design-system plan/tier cap and an upgrade link before create, surface the same information from a 402 on the create/index call, and enforce the Enterprise-only code/GitHub indexing entitlement server-side (not just in the UI).
