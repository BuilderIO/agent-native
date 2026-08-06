---
"@agent-native/core": patch
---

Stop `agent-native doctor` failing hosted builds on the database scaffold it ships with. `no-env-credentials` now allowlists two exact keys: `DATABASE_URL_UNPOOLED` (the direct-connection peer of the already-allowlisted `DATABASE_URL`, used by drizzle-kit for migrations) and `FUSION_BRANCH_KIND` (Builder deploy metadata). Both are impersonal deploy vars, never per-user credentials. Before this, `drizzle.config.ts` and `scripts/maybe-migrate.mjs` produced three findings and — since `doctor.failOnBuild` now defaults to true — aborted the build of every hosted app with a database.
