---
"@agent-native/core": patch
---

Add `deleteResolvedCredential` so a disconnect removes the credential the reader actually answers with, including a legacy `workspace` row, and refuses a member's removal of the organization's credential.
