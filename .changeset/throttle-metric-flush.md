---
"@agent-native/core": patch
---

Export metrics at most once every 10 seconds per process on serverless instead of after every response. Each metric export re-sends every series the process holds, so per-response exports made OTLP upload volume grow with request rate. Skipped points ride the next export; spans still flush after every response.
