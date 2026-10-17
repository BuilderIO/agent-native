---
"@agent-native/core": patch
---

Advertise reviewed MCP tool annotations for framework tools. The `bash`, `edit`, and `write` coding tools and the `set-service-principal-lifecycle` and `set-service-principal-policy` actions are destructive, and `ask-agent` is destructive and open-world. A file a dev server discovers as a tool still advertises destructive and open-world hints (open-world only if it is read-only) when it declares none, but those defaults now live in the action entry's new `mcpAnnotationDefaults`, so `mcpAnnotations` holds only hints an action declared itself. Export the framework action loader list so contract tests can load every entry strictly.
