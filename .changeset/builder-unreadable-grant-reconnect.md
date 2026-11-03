---
"@agent-native/core": patch
---

File upload status asks the user to reconnect Builder when their stored grant can no longer be decrypted, instead of reporting Builder as never connected while every upload fails. A usable private key still authorizes uploads and suppresses the prompt. `getBuilderUploadCredentialStatus()` from `@agent-native/core/file-upload` returns the same answer for app storage status surfaces.
