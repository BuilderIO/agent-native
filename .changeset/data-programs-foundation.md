---
"@agent-native/core": minor
---

Add the data-programs primitive: named, stored, agent-authored JS scripts executed server-side through the existing run-code sandbox, with a SQL result cache (TTL/manual refresh, background execution, stale-serve on failure). Exposes `save-data-program`, `preview-data-program`, `run-data-program`, `list-data-programs`, `get-data-program`, and `delete-data-program` actions, a `data_program` sharing-registry entry (private by default, org sharing only — never public, since a shared program executes its author's code with the viewer's credentials), and is wired into every app automatically alongside `run-code`. No new sandboxing, credential, or SSRF code — all provider access flows through the existing sandbox bridge globals (`providerFetch`, `providerFetchAll`, `providerSearchAll`, `appAction`, `workspace*`), always executing with the calling viewer's own request context.
