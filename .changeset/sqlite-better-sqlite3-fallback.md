---
"@agent-native/core": patch
---

Use better-sqlite3 for local SQLite file URLs and `@libsql/client/web` for remote libsql/Turso URLs so serverless bundles no longer depend on libsql's platform-specific native packages. The deploy bundler still copies any installed `@libsql/<platform>` natives into Netlify/Vercel/Lambda outputs as a safety net.
