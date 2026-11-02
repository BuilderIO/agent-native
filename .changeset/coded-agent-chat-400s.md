---
"@agent-native/core": patch
---

Give every 400 from the agent chat request handler and the background `_process-run` route a `code`, so a background worker failure reads `Background worker returned HTTP 400 code=<code>` instead of a bare HTTP 400 and says which request check failed. Messages and status codes are unchanged.
