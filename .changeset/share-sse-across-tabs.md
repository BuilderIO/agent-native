---
"@agent-native/core": patch
---

Share one sync stream per origin across browser tabs instead of opening one per
tab. The browser caps HTTP/1.1 connections at roughly six per origin per browser
process, so every extra tab's EventSource permanently consumed one of them and
ordinary requests queued behind the held streams — worst in local development,
where the dev gateway serves every workspace app from a single origin. Tabs now
elect a stream holder through Web Locks and receive its frames over
BroadcastChannel; followers relax to the fallback poll cadence, and Web Locks
promotes a new holder automatically when that tab closes. Browsers without Web
Locks or BroadcastChannel keep the previous per-tab behavior.
