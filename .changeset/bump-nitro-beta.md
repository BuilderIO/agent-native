---
"@agent-native/core": patch
---

Bump nitro to 3.0.260610-beta to address a dev-server cold-start race where the
Nitro Vite worker could be hit before its entry module finished importing,
surfacing as `Vite environment "nitro" is unavailable` / `UND_ERR_SOCKET`.

Also raises the `jiti` dependency floor to `^2.7.0` to satisfy the new Nitro
beta's peer requirement for downstream consumers of the published package.

Additionally registers `/_agent-native/speculation-rules.json` eagerly in the
synchronous framework init instead of relying on the async core-routes plugin.
h3 snapshots the per-request middleware list once, so the SSR-triggered fetch
for this route could land before async plugin bootstrap (or a dev HMR app
re-create) registered it, producing an intermittent 404. The route is static
and side-effect free, so eager registration keeps it in the snapshot for every
request.
