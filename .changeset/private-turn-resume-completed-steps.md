---
"@agent-native/core": patch
---

Resume a private turn after a continuation instead of failing it: completed private tool steps are recovered from their redacted ledger entries, later writes in that turn are refused rather than repeated, and an unresumable private turn now reports a clear "send the request again" message instead of "Private content omitted".
