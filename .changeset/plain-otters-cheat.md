---
"@agent-native/core": patch
---

Replace the raw gateway apology and bare `invalid_request` code in chat errors with actionable copy. The gateway's internal-error envelope is now recognized by its own shape on every stop lane, and a malformed-request rejection caused by an attachment says which formats the model reads instead of quoting a provider wire field. The raw sentence and its error id stay in the error details.
