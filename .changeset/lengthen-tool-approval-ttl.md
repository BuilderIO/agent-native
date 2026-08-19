---
"@agent-native/core": patch
---

Extend the human-in-the-loop tool approval grant window from 15 minutes to 1 hour. A user who stepped away between seeing an "Approve to run..." prompt and clicking it (e.g. to update their client) could return to a silently expired grant — clicking Approve did nothing because the durable row no longer matched `expires_at > now`, with no error shown.
