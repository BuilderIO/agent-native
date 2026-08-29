---
"@agent-native/core": patch
---

Fail a `CONTEXT=production` release migration that resolves to a local database
instead of silently migrating a throwaway file. When `DATABASE_URL` is a Netlify
secret, the CLI receives a masked value outside Netlify's own build infra, so the
prebuilt deploy lane applied migrations to a SQLite file inside the build
container, logged `Applied migration ...`, and exited 0 — publishing green while
the deployed functions kept using a remote database that never received the
schema. Scoped to the production context so the beta lane, which builds under
branch-deploy against masked secrets and is migrated by its production twin, is
unaffected.
