---
"@agent-native/core": patch
---

Retry the Builder upload gateway's start and finish calls on a 502, 503 or 504 with bounded backoff, and report their failures as a typed `BuilderGatewayError` that carries the step, attempts and a trace id instead of a whole HTML error page.
