---
"@agent-native/core": patch
---

Load the OG image and recap image route modules on their first request, trying again on the next request when a handler fails to build or its module can't be found or read, and stop rendering a request-independent copy of the sign-in page while auth mounts.
