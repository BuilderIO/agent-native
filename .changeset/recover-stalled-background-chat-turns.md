---
"@agent-native/core": patch
---

Fix a durable-background chat turn dying mid-sentence with no recovery: `/runs/active` now prefers a live successor over a stale in-memory terminal run, a hung first model-stream event checkpoints within 25s instead of riding the full 90s watchdog past the foreground platform kill, and the stale-run reapers now insert a claimable recovery successor (instead of leaving the turn dead) when a background worker dies silently.
