---
"@agent-native/core": patch
---

Agents now see the `details` a `fail()` attaches. The in-app agent and MCP tool results add an `Error details: {...}` JSON line after the message and error code, and MCP results also carry `structuredContent.error` with the message, code, and details. Details are redacted like error messages and capped at 2,000 characters; when they run over, small top-level entries are kept and the rest are listed as omitted. An action that told agents to read `details.importId` (or any other detail) now works as written.
