---
"@agent-native/core": patch
---

Add a public `GET /_agent-native/health` route that runs a trivial `SELECT 1`
to report database liveness and, as a side effect, keep a scale-to-zero
serverless database (e.g. Neon) warm. A scheduled ping against this endpoint
prevents the multi-second cold-start that otherwise stalls the first request
to an idle app. The probe always responds (apps with no database report
`db: false` rather than failing) and is never cached. Disable it with the
`disableHealth` core-routes option.
