---
"@agent-native/core": patch
---

Let signed-in members on a hosted deploy connect GitHub through the deploy's `GITHUB_INTEGRATION_CLIENT_ID` and `GITHUB_INTEGRATION_CLIENT_SECRET`, and resolve each workspace OAuth client ID and secret as a pair so a connect flow never mixes two apps' keys.
