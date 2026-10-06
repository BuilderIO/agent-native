---
type: improved
date: 2026-10-06
---

Source syncs recover from brief Jev outages on their own. Each Jev check now waits longer and retries twice, and a source that still fails is retried in about 10 minutes instead of an hour. Sync errors on the Sources page now explain what happened and what to do, instead of showing codes like `jev-timeout` or `[object ErrorEvent]`.
