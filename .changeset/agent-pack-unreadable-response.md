---
"@agent-native/dispatch": patch
---

Treat an agent pack response that is missing its `files` array as unreadable
instead of spreading it during render. The throw escaped to the router error
boundary and replaced the whole page with "Something went wrong", so the Agent
pack dialog could never report the failure. The dialog now stays open and says
the pack could not be read, and an empty pack is still distinct from an
unreadable one.
