---
"@agent-native/core": patch
---

Stop shipping `better-sqlite3` in serverless function bundles. It is a local-development driver: every consumer is gated on a `file:` or schemeless `DATABASE_URL`, and a serverless function holding a file-backed SQLite database is already broken, since the filesystem is ephemeral and each container gets its own copy. Denying the package turns that misconfiguration into a loud failure instead of a silently empty database. The denylist applies to the netlify, vercel and aws-lambda presets only, so local development is unaffected. ~1.9MB per emitted function dir.
