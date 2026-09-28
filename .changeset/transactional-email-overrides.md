---
"@agent-native/core": patch
---

Let apps replace the markup and copy of framework emails with `overrideTransactionalEmail(id, render)`, returning HTML or a React element from typed props. This covers verify signup, reset password, magic link, both email-change emails, organization invites, Builder credit limit, and the resource-shared notification. The resource-shared notification is now in the transactional email catalog as `core.resource-shared`. A catalog `preview` may now be async; `renderTransactionalEmailPreview` stays synchronous and `renderTransactionalEmailPreviewAsync` renders any preview, including overridden framework emails.
