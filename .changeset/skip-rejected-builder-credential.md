---
"@agent-native/core": patch
---

Stop resending a Builder credential the gateway already rejected. Every non-Builder provider already skipped a key marked bad by an auth failure; Builder credential selection (`resolveScopedBuilderCredentials`/`resolveBuilderCredentialsDetailed` in user/org/workspace/solo scope and the deploy-env fallback, plus `hasUsableBuilderConnection` and the env-detection path in the engine registry) now consults that same marker and falls through to the next scope instead of resending the identical known-bad key on every live and scheduled turn.
