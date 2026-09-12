---
"@agent-native/core": patch
---

Stop the automatic beta lane redirect from stranding a visitor on beta's sign-in page. Sessions are per-host, so signing in on a production host and being moved to beta produced a sign-in dead end; the automatic redirect is now marked as such, and beta undoes it once per tab when no beta session exists. Also corrects the Factory template's declared production URL, which pointed at a Netlify alias instead of its real production host.
