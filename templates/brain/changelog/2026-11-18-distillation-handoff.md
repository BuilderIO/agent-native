---
type: fixed
date: 2026-11-18
---

Distillation requests are retained when delivery cannot be confirmed. Retrying or queueing a capture now publishes its request in the same step as the queue row, so an interrupted retry leaves the item retryable instead of stranded, and an unreadable claim returns to the queue instead of stalling.
