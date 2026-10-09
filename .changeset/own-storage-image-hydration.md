---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Hydrate readable images and documents from owned storage URLs into model requests and report attachment processing failures to the model.
Send resized image payloads through their durable URLs so multiple references stay within the request's inline data limit.
