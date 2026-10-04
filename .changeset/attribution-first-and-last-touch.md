---
"@agent-native/core": patch
---

Record last touch beside first touch. The browser now keeps the latest visit that had a source (a `ref`, UTM tag or ad click id, a share link, or an outside referrer) in an `an_lt` cookie, and the signup event carries it as `last_touch_source`, `last_touch_ref`, `last_touch_via`, `last_touch_utm_*`, `last_touch_gclid`, `last_touch_msclkid`, `last_touch_vector_source`, `last_touch_referrer`, `last_touch_site_referrer`, `last_touch_path`, and `last_touch_at`. `last_touch_truncated: "true"` marks a last touch the browser had to trim to fit its cookie, or one dropped because both touches would overflow the signup handoff header, so first touch always survives. Magic-link signups carry last touch even when the browser has no first touch.

First touch is still first-write-wins, except that a visit with no source no longer blocks the first one that has a source. Referrers from `*.agent-native.com`, local dev servers, and Google sign-in don't count as a source, for capture and for `referral_source` alike. `getLastTouchAttribution()` is exported from `@agent-native/core/client/analytics`. The marketing site forwards its own last touch to the apps as `last_*` params with `last_at`, the time of that visit, and an older site visit no longer replaces a newer one the app already recorded.
