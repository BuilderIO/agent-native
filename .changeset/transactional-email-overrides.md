---
"@agent-native/core": patch
---

Let apps replace the markup and copy of framework emails with `overrideTransactionalEmail(id, render)`, returning HTML or a React element from typed props. This covers verify signup, reset password, magic link, both email-change emails, organization invites, Builder credit limit, and the resource-shared notification. The resource-shared notification is now in the transactional email catalog as `core.resource-shared`. Catalog definitions accept an optional `previewAsync`, and the new `renderTransactionalEmailPreviewAsync` renders it so overridden framework emails preview with the app's design. `preview` and `renderTransactionalEmailPreview` keep their synchronous contracts.
