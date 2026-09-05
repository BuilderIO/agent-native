---
"@agent-native/core": patch
---

Stop a tool call on the first failure, instead of retrying it three times, when its error text embeds a nested A2A/ask_app delegation's own permanent-precondition marker ("needs a setup step outside this turn" or "code: permanent_precondition").
