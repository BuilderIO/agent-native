---
"@agent-native/core": patch
---

Make a second organization stop silently orphaning vault credentials, and make
cross-app capability discoverable at runtime.

- `describeCredentialScopeGap` now also detects a key saved in a **different
  organization the caller belongs to**, so a credential miss reports the
  organization mismatch that caused it instead of only naming the missing key.
  Every `provider-api` "credential not configured" error picks this up.
- `createOrganization` logs a loud warning when it creates an additional
  organization for an account that already belongs to one, naming the credential
  consequence. The existing inline notices only reach a human clicking through
  the UI; this covers app code and migration actions calling it directly.
- New built-in `describe-workspace-apps` agent tool, available to every app. It
  reads each workspace peer's live `/.well-known/agent-card.json` and returns
  their purpose plus exact callable action names, so cross-app capability is
  discoverable without a hand-maintained catalog that goes stale.
- `A2AClient.getAgentCard()` accepts an optional `timeoutMs`.
