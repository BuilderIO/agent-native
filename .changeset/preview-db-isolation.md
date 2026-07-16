---
"@agent-native/core": patch
---

Fix Netlify preview database isolation race condition. Each PR now gets its own
`NETLIFY_DATABASE_URL_PR_<N>` env var instead of a shared `NETLIFY_DATABASE_URL`
key that concurrent PRs could overwrite. `getDatabaseUrl` and
`getMigrationDatabaseUrl` resolve the PR-specific key using Netlify's built-in
`REVIEW_ID` variable, which is injected into both build and function runtime
environments for deploy previews. Non-preview (production) builds are unaffected.
