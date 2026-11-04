---
"@agent-native/core": patch
---

Start a workspace's new app sooner and report it ready only once it serves: a `WORKSPACE_DEFAULT_APP` that isn't created yet starts as soon as it appears (without booting Dispatch), apps that need dependencies share one install, the install no longer stalls without a terminal, and non-browser requests to `/` are answered by the default app instead of a redirect.
