---
"@agent-native/core": patch
---

Retry a database connection the server refused before any statement ran (cold start, refused connect, DNS hiccup) inside the existing bounded database retry, so one transient failure no longer fails an agent chat with a 503. Errors Drizzle wraps are now classified by the driver error they carry, so a constraint, permission, or query error whose SQL or params mention a connection is never reported as "database unavailable".
