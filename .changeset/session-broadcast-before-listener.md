---
"@agent-native/core": patch
---

Read the session again when another tab broadcast a session change while this tab's app code was still loading. The early session read in the document head now records the broadcast marker it was sent under, and the session module compares it when it starts listening, so a sign-in elsewhere that nothing heard no longer leaves the tab on the previous account's session.
