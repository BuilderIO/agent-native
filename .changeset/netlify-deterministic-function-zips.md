---
"@agent-native/core": minor
---

Add `agent-native netlify-deploy`, which zips workspace functions deterministically with the installed Netlify CLI's bundler and runs `netlify deploy` in the same command, so unchanged functions keep their digest and are not re-uploaded. It fails with a `manifest-expired` line instead of silently deploying unstable ZIPs.
