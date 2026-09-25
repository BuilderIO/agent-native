---
"@agent-native/core": patch
---

Close three remaining gaps in the hosted-database guard (refuses to silently open ephemeral PGlite when `DATABASE_URL` is missing on a real deployment): Cloudflare Pages' generated worker entry now sets `globalThis.__env__` like the Module/Workers entry already did, a production Node/Docker server now refuses PGlite too, detected via a process-local marker set the first time the real Nitro app wires up its H3 routes rather than an env-var heuristic that would misfire during builds, and Better Auth's database adapter setup now calls the same guard, so signup/login fail with `HostedRuntimeLocalDatabaseError` instead of attempting PGlite. Also exempts migration-authorized runtimes (`withMigrationRuntime()`) from the guard, since a durable background worker can be a real hosted invocation and is allowed to touch PGlite there.
