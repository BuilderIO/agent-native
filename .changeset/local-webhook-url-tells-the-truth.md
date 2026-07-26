---
"@agent-native/core": patch
---

Integrations panel: stop offering a local-only webhook URL as if it will work.

Slack, WhatsApp, and Telegram verify a webhook Request URL by calling it from
their own infrastructure, so the loopback URL a local dev server produces
(`http://127.0.0.1:8101/...`) can never pass verification. The webhook slot now
detects non-public URLs — loopback, `0.0.0.0`, `::1`, `*.local`, private LAN
ranges, and any plain-`http:` origin — and swaps the copyable URL for a short
explanation: deploy the app, or expose the server through an HTTPS tunnel, then
reopen the page from the public address. Publicly reachable URLs are unchanged.
