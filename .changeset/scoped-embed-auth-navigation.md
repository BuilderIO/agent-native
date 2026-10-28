---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Workspace app mounts keep embedded credentials and browser tab identity scoped to the resolved mount. Successful agent navigation refreshes only the originating tab's route state, and resource views stay current when Vite serves duplicate Core module instances.
