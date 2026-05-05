---
"@agent-native/core": patch
"@agent-native/dispatch": patch
"@agent-native/scheduling": patch
"@agent-native/pinpoint": patch
---

Add `publishConfig.provenance: true` so `pnpm publish` (called by `changeset publish` from the auto-publish workflow) requests an OIDC token from GitHub Actions and publishes via npm trusted publisher. Without this, `pnpm publish` looked for token-based auth and failed with `ENEEDAUTH`.
