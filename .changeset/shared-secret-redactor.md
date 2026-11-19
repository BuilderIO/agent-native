---
"@agent-native/core": patch
---

Redact secrets in error text, tool errors, audit rows, trace captures and desktop logs with one shared redactor (`@agent-native/core/shared/secret-redaction`). It now also covers JSON keys, `?key=` and `?code=` style query values, database connection strings, bare provider keys, JWTs, PEM blocks, webhook URLs and Bearer tokens that some of those sinks used to let through.
