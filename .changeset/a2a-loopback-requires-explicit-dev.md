---
"@agent-native/core": patch
---

Harden unsigned A2A access on self-hosted deployments. When neither `A2A_SECRET` nor `apiKeyEnv` is configured, both the JSON-RPC endpoint and the `_process-task` processor route now require BOTH a loopback socket peer AND a positive dev signal (`NODE_ENV=development` or `NODE_ENV=test`) — or the explicit `A2A_ALLOW_UNSIGNED_INTERNAL=1` opt-in. Loopback alone is no longer sufficient: a public request forwarded by a local reverse proxy (Nginx/Caddy) to an app bound on `127.0.0.1` on a bare Docker/VPS/K8s host with unset or unrecognized `NODE_ENV` now fails closed instead of being accepted as anonymous.
