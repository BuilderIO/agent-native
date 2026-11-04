---
"@agent-native/core": patch
---

Treat null on an optional action field as "not provided" for every call prepared through `actionCallIntent` (agent loop, MCP, HTTP, A2A, scripts), not only the agent loop. A padded call still refuses when it would clear data: a null on a nullable field, or an empty value that differs from the schema default. Declared read-only calls and empty values equal to the default run. The strip also walks nested unions.
