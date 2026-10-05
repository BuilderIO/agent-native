---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add FXMacroData's remote MCP server to the integration catalog for FX rates, macroeconomic releases, and central bank data. It connects without a key for USD data; adding it as a custom integration with an `Authorization: Bearer` API key unlocks every supported currency.
