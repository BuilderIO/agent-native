---
"@agent-native/core": patch
---

Fix Builder.io's managed storage provider returning 400 "No image specified" for `application/json` and `text/plain` chat attachments by routing those mimetypes through the signed-URL upload path instead of the legacy endpoint. Also normalize thrown provider upload errors to a 503 response instead of leaking the provider's raw status code.
