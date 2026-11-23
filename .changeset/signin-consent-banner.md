---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

The sign-in page now shows the cookie banner to visitors in the consent region, under the sign-in card and in the page's language, so a visitor can accept before signing up and have their signup attributed. Accept all, Reject all and Manage settings work as in the app. A visitor sent to the sign-in page from an app page keeps that page's `utm_*` and other source fields: `captureAttribution` takes a `landingSearch`, read when the sign-in URL has no source of its own. The server `signup` event now says why it carries no attribution: `attribution_consent` when `targeting` was not allowed and `analytics_consent` when `performance` was not, each `"withheld"` (the visitor said no, or their country needs a choice they hadn't made) or `"unknown"` (no choice and no usable country). Core now exports the banner copy as `@agent-native/core/localization/privacy-choice-messages`.
