---
"@agent-native/core": patch
---

Advertise reviewed MCP tool annotations for framework tools. The `bash`, `edit`, and `write` coding tools and the `set-service-principal-lifecycle` and `set-service-principal-policy` actions are destructive, `ask-agent` is destructive and open-world, and a file a dev server discovers as a tool is destructive and open-world unless it declares hints of its own or is read-only. Export the framework action loader list so contract tests can load every entry strictly.
