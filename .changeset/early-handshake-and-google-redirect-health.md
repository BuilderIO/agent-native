---
"@agent-native/core": patch
---

`/_agent-native/health/google` now probes the actual configured redirect URI
against Google, not just the client id/secret. `redirect_uri_mismatch` — the
most common real-world Google OAuth failure — used to be invisible to this
health check; it now shows up as `redirectUriStatus: "mismatched"` and pages
(503) alongside the existing `status: "invalid"` case, gated so a managed pair
intentionally left unregistered (declared `managedConnection` other than
`"required"`) doesn't false-page.

`/_agent-native/identity` and `/_agent-native/embed/start` (the workspace-app
SSO and MCP App embed handshake routes) are now registered synchronously
before the DB-dependent bootstrap chain, alongside `/ping` and `/health` —
previously a cold function made the desktop/mobile shell's embed handshake
wait 4-5s for unrelated init before first paint. Security response headers
and the framework CORS middleware moved earlier with them so both routes
still get baseline protection.

`/_agent-native/health` also reports an additive
`alerts.chatHealthSlackWebhookConfigured` boolean so an unconfigured
`NOTIFICATIONS_SLACK_WEBHOOK_URL` — which silently no-ops the chat-health
outage alert — is visible instead of only discoverable by nobody getting
paged during an outage.
