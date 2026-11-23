---
"@agent-native/core": patch
---

After an approved tool call runs, tell the model it already ran while keeping instructions the approver sent with the approval, keep the waiting message before the result, resolve a later approval whose client turn id drifted, stop an approval continuation when a client-turn stop races with admission, and do not tell the model the action already ran when the grant re-pauses or the approved call fails.
