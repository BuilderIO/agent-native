---
"@agent-native/core": patch
---

Session replay recordings now say which code they ran and what happened along the way: uploads carry the git commit the page was built from when the build's environment names one, each in-app route change is marked with its path, and a failed agent run is marked with its error code, never its message.
