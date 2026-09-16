---
"@agent-native/dispatch": patch
---

Fix `import-agent-pack`, `import-agent`, and `connect-external-agent` throwing an unhandled 500 when given invalid input (a non-agent-pack file, malformed JSON, a malformed endpoint URL, or a duplicate destination). These now return a clean, actionable validation error instead.
