---
"@agent-native/core": patch
---

Allocate resource-history version numbers from a dedicated per-resource
counter instead of `MAX(version_number) + 1`, so deleting the newest version
can no longer free its number for reuse by the next save. The counter is
backfilled from any pre-existing `agent_resource_versions` rows on init, so a
resource with history already present does not exhaust its allocation
retries on the first save after this counter is introduced. Also export
`deleteResourceVersionById` from the history package entrypoint so consumers
can compensate a version insert when a following write fails.
