---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Run the once-a-minute scheduled sweep on Vercel and Cloudflare Workers. Vercel builds now add a cron job that calls the sweep with `CRON_SECRET`, and Cloudflare builds add a Cron Trigger whose `scheduled` handler calls it with a token signed by `A2A_SECRET`, so scheduled automations, queued event automations, and stale-run cleanup no longer stop on those hosts. Vercel Hobby rejects a deployment whose cron runs more than once a day, so Hobby projects must set `AGENT_NATIVE_VERCEL_CRON_SCHEDULE` to a daily expression such as `0 9 * * *` before deploying this version. Both schedulers request the public sweep path, so a custom `runtime.frameworkRoutePrefix` or app base path is honored. A workspace Vercel deploy takes each app's cron from that app's own build, so every app in the workspace must build with this version of `@agent-native/core`; the deploy fails and names any app whose build scheduled no sweep. The Automations page now names a missing trigger secret and no longer claims event automations still run on a host without a scheduler or in a build with recurring jobs turned off.

On a cold Cloudflare Worker, framework routes no longer return 404 or wait out the readiness timeout: the request telemetry hook no longer throws where `AsyncLocalStorage.enterWith()` is unavailable, and pending plugin initialization is passed to `waitUntil` so it can continue after the response is sent.
