---
"@agent-native/core": patch
---

Make a slow cold-start response diagnosable from one look. HTTP telemetry now
reports the pre-handler boot phases (`boot_to_module_ms`, `module_to_request_ms`)
that no in-handler measurement can see, logs one structured line to stdout for
every cold or slow (>=1s) request, and stops putting live-looking per-phase
`server-timing` entries on shared-cacheable responses — a CDN replays those
bytes, so a cacheable response now carries a single `origin` entry stamped with
the wall-clock time of the render that produced it.
