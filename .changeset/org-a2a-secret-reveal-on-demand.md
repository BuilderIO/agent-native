---
"@agent-native/core": patch
---

Stop sending the organization A2A secret in `GET /_agent-native/org/me`. That
route runs on every page load, so the secret that signs first-party A2A/MCP
JWTs was sitting in JSON any script on the page could read. `/org/me` now
returns only `a2aSecretSet: boolean` for owners/admins, and the value is
fetched on demand from the new owner/admin `GET /_agent-native/org/a2a-secret`
(`useRevealA2ASecret()`) when an operator reveals or copies it. Apps that read
`OrgInfo.a2aSecret` should switch to `a2aSecretSet` plus `useRevealA2ASecret()`.
Deployments whose secret was previously exposed should rotate it from the Team
page (Regenerate then Sync to apps).
