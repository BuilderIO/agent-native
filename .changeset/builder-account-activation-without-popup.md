---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Creating a Builder.io account from "Create and activate" or "Create Builder.io account" is now one `POST /_agent-native/builder/provision` request with no popup window, so popup blockers no longer stop it; only connecting an existing account opens Builder's sign-in window, and composer runtimes without the consent popover never create an account.
