---
"@agent-native/core": patch
---

S3 upload failures now throw `S3RequestError`, which carries the bucket's HTTP `status` and `provider: "s3"`, so an app can tell a refused bucket (wrong keys, a denying policy, a missing bucket) from an outage and point people at storage settings.
