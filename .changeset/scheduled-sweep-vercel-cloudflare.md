---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Run the once-a-minute scheduled sweep on Vercel and Cloudflare Workers. Vercel builds now add a cron job that calls the sweep with `CRON_SECRET`, and Cloudflare builds add a Cron Trigger whose `scheduled` handler calls it with a token signed by `A2A_SECRET`, so scheduled automations, queued event automations, and stale-run cleanup no longer stop on those hosts. Set `AGENT_NATIVE_VERCEL_CRON_SCHEDULE` to a daily expression on Vercel Hobby. The Automations page now names a missing trigger secret and no longer claims event automations still run on a host without a scheduler.

On a cold Cloudflare Worker, framework routes no longer return 404 or wait out the readiness timeout: the request telemetry hook no longer throws where `AsyncLocalStorage.enterWith()` is unavailable, and the request that starts plugin initialization stays open until it finishes.
