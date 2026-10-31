---
"@agent-native/core": patch
---

Fix the WebMCP page helper failing with "invalid input object" in Chrome 155+ by passing object input to `executeTool` instead of a JSON string.
