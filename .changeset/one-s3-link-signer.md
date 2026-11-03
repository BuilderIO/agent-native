---
"@agent-native/core": patch
---

`presignS3GetUrl` takes `trustedEndpoint`, so an app whose S3 endpoint comes from its deployment can sign links for a plain-HTTP endpoint such as a local MinIO. Without it, links still need HTTPS. `readS3ErrorText` also no longer throws when an error body fails partway, so a failed S3 request keeps its status in the error message.
