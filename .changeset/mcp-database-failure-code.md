---
"@agent-native/core": patch
---

A database failure over MCP now names its driver error code without the query, as in `The database request failed (57014).`. MCP analytics records the same code as the error type. A failure with no well-formed code keeps the plain text.
