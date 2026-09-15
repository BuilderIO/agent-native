---
"@agent-native/core": patch
---

Say what a credits rejection actually blocked on. A `credits-limit-*` stop now reports the exceeded window, the reset time whenever `Retry-After` measured one, and the allowance and plan whenever the Builder gateway reports them, and pairs the upgrade CTA with a link to Builder.io's per-plan Agent Credit allowances instead of leaving the reader with an unqualified "you've reached the limit". The limit is never hardcoded, so a plan change cannot turn the message into a confident wrong number.

User-facing copy for this balance now uses Builder.io's own product name, Agent Credits, everywhere the framework surfaces it — error messages, the Builder connect card, and onboarding — so it matches the billing page the upgrade CTA opens.
