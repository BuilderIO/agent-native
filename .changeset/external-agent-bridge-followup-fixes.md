---
"@agent-native/core": patch
---

External-agent bridge follow-up fixes: add `/_agent-native/mcp` to the auth
bypass allowlist so the stdio proxy / external MCP clients reach the endpoint's
own `verifyAuth` (was 401); static `ACCESS_TOKEN` requests now carry caller
identity via `AGENT_NATIVE_OWNER_EMAIL`/`X-Agent-Native-Owner-Email`; `open_app`
/ `create_workspace_app` use the target app origin and `ask_app` routes
cross-app over A2A honestly; validate decoded compose `draft.id` in
`/_agent-native/open`; swallow benign post-flush `ERR_STREAM_WRITE_AFTER_END`;
fix the local-dev auto-account email (`dev@local` → `dev@local.test`, rejected
by better-auth 1.6.0) with legacy dual-exclusion.
