---
"@agent-native/core": patch
---

Revert keep-warm concurrency. Measured on production and it changed nothing:
before 8/10 requests cold, after 9/10 and 8/10, and 6/6 cold at 25s spacing.
Netlify does not hold these containers long enough for warming to matter — a
container is reused at a 2s gap and already cold again by 8s — so no cron
cadence or concurrency can help. Restores one warm request per minute rather
than paying 3x the scheduled invocations and health-probe round trips for no
effect.
