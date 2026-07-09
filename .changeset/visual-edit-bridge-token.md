---
"@agent-native/core": patch
---

Fix `/visual-edit` live-edit 401s. The design server now mints the bridge token in `connect-localhost` and returns it from `open-visual-edit`, and `design connect` adopts it via a new `--bridge-token` flag (or `AGENT_NATIVE_BRIDGE_TOKEN`) instead of minting its own. The local bridge and the user's connection row now share the secret without the CLI needing its own auth to self-register — which was impossible under OAuth-based MCP and was the root cause of the 401s. The `visual-edit` skill is updated to call `open-visual-edit` first and start the bridge with the returned token.
