---
"@agent-native/core": patch
---

Database admin: make the agent's db-admin tools available whenever the DB admin
itself is (`NODE_ENV === "development"`), instead of only when the agent
Code-mode toggle is on. This gives true agent/UI parity — the agent can read and
edit the full database through `db-admin-*` tools in App mode too — and the tool
descriptions now steer the agent to prefer them over the scoped `db-exec`/
`db-query` for admin work and for tables without `owner_email`/`org_id` scoping.
