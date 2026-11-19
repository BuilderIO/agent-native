---
"@agent-native/core": patch
---

Allow apps to schedule durable chat queue admission and manage sharing for their own conversations. A fork the app keeps unshared is refused with 403 rather than reported missing, and queue admission inside an app's transaction commits or rolls back with it under an execution lease.
