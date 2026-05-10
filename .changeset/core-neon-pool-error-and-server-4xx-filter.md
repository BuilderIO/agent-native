---
"@agent-native/core": patch
---

- db/neon: Attach a logging error listener to the Neon serverless Pool. Without one, Node 24 surfaces routine WebSocket drops (idle timeout, Lambda suspend, network blip) as fatal `Unhandled error` / `Connection terminated unexpectedly` uncaught exceptions even though the next query would have transparently reconnected. The pool now logs and swallows these so they don't crash the function or fill Sentry.
- server/sentry: Drop 4xx HTTPError / H3Error from `beforeSend`. h3's `createError({ statusCode: 4xx })` is the documented way to return 404 / 400 / 401 from a route — those bubble through Nitro's error hook and were getting captured as Sentry issues. Match by statusCode when present, fall back to message heuristics ("not found", "Cannot find any route matching", "No access to …", "Unauthenticated") so handler-thrown 4xx don't bury real bugs.
