---
"@agent-native/core": patch
---

Capture first-touch referral attribution and enrich the signup event (`referral_source`, `referrer_user`, UTM, `first_touch_path`) to measure app virality. The browser records an anonymous visitor's first-touch context (`ref`/`via`/`utm_*` params, landing path, and referring host) into an `an_attribution` localStorage key and a first-party `an_ft` cookie, and the server-side `signup` event is enriched from that cookie so every template can see where new users came from.
