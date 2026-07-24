---
"@agent-native/core": patch
---

Stop an upstream provider error from reporting the Builder connection as broken.
A gateway error arriving inside an already-authenticated stream is now only
treated as a credential failure when the message names the credential; a bare
"Unauthorized" is surfaced as `builder_model_unauthorized` ("the provider behind
this model rejected the request") without recording an auth-failure marker.
Builder auth-failure markers also expire after 15 minutes, matching provider
markers, so a signed-in user can no longer be pinned to "not connected"
indefinitely.
