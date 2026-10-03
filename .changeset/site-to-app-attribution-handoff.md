---
"@agent-native/core": patch
---

Capture `site_referrer` and `site_landing_path` from an app's landing URL into first-touch attribution and record them on the signup event. The marketing site forwards them on app links, so a visitor who reached www.agent-native.com from GitHub, YouTube, or search keeps that source when they sign up in an app. A forwarded referrer derives `referral_source: "external"`, the same as a referrer the app saw itself.
