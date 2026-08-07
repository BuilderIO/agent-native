---
"@agent-native/core": patch
---

Make the serverless request-path migration skip opt-in via
`AGENT_NATIVE_RELEASE_MIGRATIONS`.

`runMigrations` skips schema work in a production serverless request runtime,
which is correct only for an app that migrates somewhere else. Exactly one of
seventeen templates has a release migration entrypoint. For the other sixteen,
an unconditional skip would not defer the work — it would delete it: a newly
added migration silently never applies, and a fresh deploy comes up with
missing tables. Nothing fails at the moment of the skip, so the first symptom
is a missing-table error in production, far from the cause.

An app now declares that it owns migrations at release time by setting
`AGENT_NATIVE_RELEASE_MIGRATIONS=1`. Analytics sets it in `netlify.toml`
alongside its `migrate:production` build step; every other app keeps its
existing behavior until it has one.

Note that the Netlify _build_ environment also sets `NETLIFY=true`, so the
release step itself looks like a serverless request to this guard — it works
only because the entrypoint claims duty through `withMigrationRuntime()`. A
migration entrypoint that forgets that wrapper silently no-ops at build time.
