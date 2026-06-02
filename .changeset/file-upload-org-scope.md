---
"@agent-native/core": patch
---

Fix file uploads failing with a misleading "needs file storage" error when Builder.io was connected at org scope. The `/_agent-native/file-upload` route (and its status endpoint) now resolve the active org and include `orgId` in the request context, so org-scoped Builder credentials are found during upload.
