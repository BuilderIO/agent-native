---
"@agent-native/core": patch
---

A database failure over MCP now names its driver error code without the query: `The database query timed out (57014).` for a timeout and `The database rejected the request (53300).` otherwise. MCP analytics records the same code as the error type. A failure with no well-formed code keeps the plain text.
