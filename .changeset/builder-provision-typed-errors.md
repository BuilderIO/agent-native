---
"@agent-native/core": patch
---

Builder.io "Create and activate" now reports why account creation failed. Timeouts, an unreachable Builder host, a rejected signature (401/403), rate limiting, invalid account details, Builder server errors, and malformed responses each return their own typed code and message instead of the generic "Couldn't create your Builder.io account" for every failure.
