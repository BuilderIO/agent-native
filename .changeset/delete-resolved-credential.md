---
"@agent-native/core": patch
---

Add `deleteResolvedCredential` so a disconnect removes the credential the reader actually answers with, including a legacy `workspace` row, and refuses a member's removal of the organization's credential. `deleteCredential(key, { scope })` now clears every row that owner holds (secret, legacy setting, and legacy workspace/solo row), so a save that clears a value at its chosen scope never touches the other owner's.
