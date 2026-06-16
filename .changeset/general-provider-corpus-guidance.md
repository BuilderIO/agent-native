---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Teach all app agents that provider shortcut actions are not capability limits and that broad provider searches, joins, classifications, and absence claims should use provider API staging, saved responses, staged-dataset queries, or sandboxed code with explicit coverage reporting. Ensure lean, A2A, and MCP ask-agent registries include run-code when code execution is enabled, and give sandboxed code generic providerRequest/providerFetchAll helpers for broad paginated provider corpus work.
