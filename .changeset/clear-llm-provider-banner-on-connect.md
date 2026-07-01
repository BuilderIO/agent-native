---
"@agent-native/core": patch
---

Fix the "No LLM provider is connected" chat banner staying visible after a
provider is connected. The composer now clears that error once the engine
status flips to configured, and the status check no longer reads a stale
cached "missing" response after connecting.
