---
"@agent-native/core": minor
---

Add optional `resumable` capability to `FileUploadProvider` for streaming uploads. Providers that implement `startSession`, `relayChunk`, and `completeSession` can receive video chunks during recording instead of waiting for a fully assembled file after stop. The Builder.io provider implements this via the GCS resumable upload protocol. Also exports `ResumableUploadSession` and `ResumableChunkResult` types.
