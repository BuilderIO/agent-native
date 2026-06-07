---
"@agent-native/core": patch
---

Fix `zodDefToJsonSchema` to handle Zod v4 `"pipe"` type produced by `z.preprocess()`, `.superRefine()`, and `.transform()`. Previously these fell through to the `{ type: "string" }` fallback, causing action parameters whose schemas use `z.preprocess` (such as `content` in `create-visual-plan`) to be registered as strings in the MCP tool schema. Claude Code and other MCP clients would then JSON-encode object values as strings before sending, breaking validation.
