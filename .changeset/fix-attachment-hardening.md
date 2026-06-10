---
"@agent-native/core": patch
---

Harden attachment handling across the chat surface:

- **HEIC/TIFF/AVIF images**: always transcode non-web-safe image formats (HEIC, TIFF, AVIF, BMP, etc.) to JPEG/PNG via canvas before attaching; throw a visible composer error if transcoding fails instead of silently attaching raw bytes. Server-side, inject a text placeholder for any unsupported image that bypasses the client so the model knows the image was present.
- **Base64 images in prompt text**: stop inlining image data-URLs into the text prompt string (≈700K tokens per MB); CLI code-agent now passes images as proper engine `image` content parts. PromptComposer no longer inlines images into prompt text.
- **PDF and body-size caps**: cap PDFs at 4 MB with a clear composer error; estimate the total serialized attachment body and aggressively re-compress images if over 3.5 MB, rejecting the largest attachment with a clear error if still over.
- **Server-side upload limits**: `/file-upload` and `/resources/upload` now enforce a 25 MB file size cap (413) and reject executable/script MIME types (415). New `readBodyWithSizeLimit`, `isAllowedUploadMimeType`, and related constants exported from `@agent-native/core/server`.
- **Silent failure UX**: drag-drop and paste attachment errors are now surfaced as a dismissible inline error banner above the composer instead of silently logging to the console.
