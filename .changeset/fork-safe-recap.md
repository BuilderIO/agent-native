---
"@agent-native/core": patch
---

Add `forkPr` flag to `buildRecapPrompt` that injects a prompt-hardening security note when the diff originates from a fork PR, marking diff content as untrusted user-supplied data rather than instructions.
