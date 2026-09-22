---
"@agent-native/core": patch
---

Cut action latency and false failures across apps: batch per-user profile and
feature-flag settings reads into one query; on production serverless runtimes,
answer the app-origin SSE route with 204 for current clients (a held stream
there forced a cold container per connection) and report a `poll-live`
capability so sync consumers keep their normal cadence over `/poll`; stop
`refetchInterval` polling after a 401; skip feature-flag and labs queries until
the session is authenticated; attribute `http.response` telemetry to the app;
and add cold-start, hidden-page, and timeout fields to `action.response`.
