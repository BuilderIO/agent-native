---
"@agent-native/core": patch
---

Stop shipping the 9.3MB libsql native driver to deployments that never load it. `copyInstalledLibsqlNativePackages` ran unconditionally for netlify/vercel/aws-lambda, unlike its Chromium sibling which is gated on a real consumer probe. It is now gated the same way, on whether the emitted bundle actually imports the bare `libsql` addon — the only gate that cannot be wrong, since `getDialect()` reads `DATABASE_URL` at runtime and build-time dialect is unknowable. The one importer in the server graph was the `db-check-scoping` maintenance script, which now uses the existing `createSqliteScriptClient` (dynamic `better-sqlite3` / `@libsql/client/web`) instead of the static node entry. Measured on the docs app: server function 55.9MB → 46.6MB.
