---
"@agent-native/core": minor
---

Add an optional `brandLogoUrl` to `renderEmail` and a `getShareEmailLogoUrl` resolver on `registerShareableResource`, so share-notification emails show the sharing org's logo (absolute `https://`) when available and fall back to the embedded Agent Native logo otherwise.
