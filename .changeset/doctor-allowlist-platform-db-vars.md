---
"@agent-native/core": patch
---

Stop `agent-native doctor` failing hosted builds on the database scaffold it ships with. `no-env-credentials` now allowlists `DATABASE_URL_UNPOOLED` (the direct-connection peer of the already-allowlisted `DATABASE_URL`, used by drizzle-kit for migrations) and the `FUSION_` platform prefix, alongside the existing `NETLIFY_`/`VERCEL_`/`CF_` ones. Both are impersonal deploy vars, never per-user credentials. Before this, `drizzle.config.ts` and `scripts/maybe-migrate.mjs` produced three findings and — since `doctor.failOnBuild` now defaults to true — aborted the build of every hosted app with a database.
