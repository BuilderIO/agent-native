---
"@agent-native/core": patch
---

Add `getFeatureFlagRulesStrict` to `@agent-native/core/feature-flags` for flags that route data. An unconfigured flag reads as off, as it does with `getFeatureFlagRules`. An unregistered key or malformed stored rules throw `FeatureFlagRulesError` instead of quietly reading as off.
