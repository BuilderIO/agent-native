---
"@agent-native/core": patch
---

Load the OG image and recap image route modules on their first request, retrying a failed load on the next request, and stop rendering a request-independent copy of the sign-in page while auth mounts.
