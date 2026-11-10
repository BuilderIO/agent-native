---
"@agent-native/core": patch
---

Answer a refused padded tool call (`ambiguous_tool_placeholders`) on the HTTP action route with a 400 and its resend-sparse message, instead of a generic 500 that was captured as a server failure. Nothing runs either way; MCP and the agent loop already showed the message.
