---
"@agent-native/core": patch
---

A foreground data program now shares one run with everyone in the org who can open it, when the run used only the org's own credentials. On a cache miss in an org it first runs with org credentials only and records every credential it reads. It keeps that run for the org only if every credential was the org's own stored secret or setting, no provider lookup failed, and its only tool calls were provider API requests. A viewer is served the shared run only when each of those credentials, and each provider it called, resolves the same way for them. Anyone with their own key or connection for one of them gets their own run, as before. Runs that read a personal credential, a workspace connection or app data stay per viewer. Background programs are unchanged.
