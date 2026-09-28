---
"@agent-native/core": patch
---

Let apps replace the markup and copy of framework emails with `overrideTransactionalEmail(id, render)`, returning HTML or a React element from typed props. This covers verify signup, reset password, magic link, both email-change emails, organization invites, Builder credit limit, and the resource-shared notification. The resource-shared notification is now in the transactional email catalog as `core.resource-shared`. `renderTransactionalEmailPreview` now returns a Promise, and a catalog `preview` may be async.
