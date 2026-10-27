---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Workspace app mounts keep embedded session tokens isolated in shared browser storage. Successful agent navigation refreshes the originating tab's route command immediately, and resource views stay current when Vite serves duplicate Core module instances.
