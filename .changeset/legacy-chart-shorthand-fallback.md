---
"@agent-native/core": patch
---

Render a best-effort inline chart when an agent emits a hallucinated `/word ... labels=[...] data=[...]` line in chat instead of the documented ```embed fence. Previously that line rendered as inert literal text with no chart. Detection is generic (not tied to any single template's tool name), rejects malformed input (mismatched lengths, negative values, oversized arrays) by falling back to plain text, and correctly skips content inside fenced/indented code blocks.
