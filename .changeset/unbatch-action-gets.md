---
"@agent-native/core": patch
---

Send each action GET as its own request again and remove the `get-actions-batch` action. On serverless hosts every request gets one database connection, so a batch ran its items' queries one after another, while separate requests run them in parallel. On Content's beta site, batching added about 1.3 seconds to the first open of a document.
