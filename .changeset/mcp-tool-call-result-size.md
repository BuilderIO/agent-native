---
"@agent-native/core": patch
---

`$mcp_tool_call` now records how big each result is: `$mcp_response_text_chars` counts the characters in its text blocks, and `$mcp_response_structured_chars` its structured content as JSON, when it has any. MCP hosts cut or move a result past about 40,000 characters, and Claude Code and OpenCode show the model only the structured content while Codex shows both, so the two are counted apart. Only the numbers are sent; the result's text stays out of analytics.
