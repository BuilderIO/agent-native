---
"@agent-native/core": patch
---

Treat null on an optional action field as "not provided" for every caller (agent loop, MCP, HTTP, scripts), not only the agent loop. A padded call still refuses when it would clear data: a null on a nullable field, or an empty value that differs from the schema default. Read-only calls and empty values equal to the default run.
