---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Report Builder credit-service outages and unverifiable provider key checks as typed, retryable failures instead of generic 500s and "rejected key" 400s, and accept OpenAI project keys restricted from listing models.
