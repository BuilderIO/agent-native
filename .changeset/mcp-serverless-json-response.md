---
"@agent-native/core": patch
---

Use JSON request/response framing for stateless MCP transport so serverless
deployments do not drop SSE tool results after invocation freeze.
