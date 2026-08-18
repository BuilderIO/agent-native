---
"@agent-native/core": patch
---

Show Approve/Deny again when a tool approval has to be re-asked. `approval_required` now carries an `askId` identifying that specific gate hit, and the chat retains a user's resolution per ask instead of per approval key. Previously, if a resume never consumed the grant (expired TTL, turn-id mismatch), the server re-asked for the same call and the client still showed the quiet "Approved" note — the buttons never came back, so the action silently never ran and there was no way to retry.
