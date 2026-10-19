---
"@agent-native/core": patch
---

Tag first-run onboarding analytics events with an experiment id and variant so setup-page tests can be compared in Analytics. Persist the assignment so first-run outcome events retain the variant across reloads. Add `isAgentNativeAnalyticsConfigured()` so experiments can skip users whose events have no analytics destination.
