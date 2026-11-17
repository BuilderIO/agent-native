---
"@agent-native/core": minor
---

Add extension points for deployment-owned provider admission. `registerProviderCallGate` (from `@agent-native/core/provider-api`) lets an app or module claim provider requests by provider id or URL and refuse, debit or rate-limit them before dispatch, with a shared interactive scope (`runWithProviderInteractiveScope`, `isProviderInteractiveScope`) for foreground-only modes. App config section fields can declare their own environment parser with `.meta({ env, envParse })`, and `.catch()` fields resolve env aliases. `registerProviderPausedErrorCodes` (from `@agent-native/core/client`) makes the action failure circuit hold automatic refetches on a provider pause while letting a visible surface read through. `assertProviderPauseOperator` and the `PROVIDER_PAUSE_OPERATOR_EMAILS` / `PROVIDER_PAUSE_OPERATOR_ORG` settings decide who may flip a deployment-wide provider pause. Nothing changes until something registers.
