---
"@agent-native/core": minor
---

Upload-first chat attachments: when a file-upload provider is configured, images and files are uploaded to hosted URLs at send time and stored as URL references in thread_data (no more base64 blobs in SQL). Added `read-attachment` core tool for paginating large text attachments that exceed the 60 K context limit. Base64 fallback path retained with a 2 MB-per-attachment cap.
