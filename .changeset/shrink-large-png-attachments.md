---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Oversized PNG, JPEG, GIF, and WebP attachments are now downscaled on the server before they reach the model, so non-browser senders (MCP, Slack, A2A, API) get the image instead of a size note. Images past the browser's shrink limits (25 MB or 40 megapixels) are refused when attached, with the size or pixel reason, whether or not file storage is connected.
