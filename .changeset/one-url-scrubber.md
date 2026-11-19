---
"@agent-native/core": patch
---

Scrub URLs with one allowlist: only attribution parameters (`ref`, `via`, `utm_*`, click ids) keep their values in a query or hash, and analytics, Sentry and error reports send the route template (`/share/:shareId`) instead of the raw path. `scrubUrl` is also exported from `@agent-native/core/client/url-scrub` with a `routePath` option. `configureTracking` takes `routeTemplates: false` for a public content site that needs its real page paths.
