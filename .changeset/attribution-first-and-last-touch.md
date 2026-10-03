---
"@agent-native/core": patch
---

Record last touch beside first touch. The browser now keeps the latest visit that had a source (a `ref` or UTM tag, a share link, or an outside referrer) in an `an_lt` cookie, and the signup event carries it as `last_touch_source`, `last_touch_ref`, `last_touch_utm_*`, `last_touch_referrer`, `last_touch_site_referrer`, `last_touch_path`, and `last_touch_at`. When both touches would overflow the signup handoff header, last touch is dropped and `last_touch_truncated: "true"` is set, so first touch always survives.

First touch is still first-write-wins, except that a visit with no source no longer blocks the first one that has a source. Referrers from `*.agent-native.com` and Google sign-in don't count as a source. `getLastTouchAttribution()` is exported from `@agent-native/core/client/analytics`, and the marketing site forwards its own last touch to the apps as `last_*` params.
