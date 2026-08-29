---
"@agent-native/core": patch
---

Fail a `CONTEXT=production` release migration whose database URL is local or
unconnectable, instead of silently migrating a throwaway file. Netlify hands the
CLI a masked secret outside its own build infra, so the prebuilt deploy lane
applied the whole schema to a SQLite file in the build container, logged
`Applied migration ...`, exited 0, and published green while the deployed
functions kept using a remote database that never received the schema. A masked
value is neither empty nor a `file:` URL, so a local-database check alone does
not see it — the guard now also requires a real URL scheme. Scoped to the
production context so the beta lane, which builds under branch-deploy against
masked secrets and is migrated by its production twin, is unaffected.
