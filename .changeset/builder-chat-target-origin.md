---
"@agent-native/core": patch
---

`sendToBuilderChat` accepts a `targetOrigin` for embedders that verified the
Builder parent through a handshake. `getBuilderParentOrigin()` requires
`?builder.*` params to trust a loopback parent, so those embeds previously fell
back to posting `"*"`.
