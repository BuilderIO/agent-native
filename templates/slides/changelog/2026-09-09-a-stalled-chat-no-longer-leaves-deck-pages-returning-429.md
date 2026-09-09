---
type: fixed
date: 2026-09-09
---

After a chat stalls, reloading a deck no longer runs into a repeated "too many requests" error page. The app now waits out the server's rate limit instead of retrying into it, and reloading keeps that wait rather than starting over.
