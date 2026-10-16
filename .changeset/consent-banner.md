---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Add a cookie banner for visitors in the countries builder.io asks for consent (the EU, the rest of the EEA and a few nearby territories). `AppProviders` mounts `ConsentBanner`, which offers Reject all, Accept all and per-category settings for analytics and advertising. There, Google Analytics and Amplitude wait for analytics consent, and Google Tag Manager, with the ad pixels it carries, waits for advertising consent. Google's tags follow Google Consent Mode, so a later reject stops tags already on the page from storing or sending identifiers. Session replay also waits for analytics consent there, and a reject discards what it hasn't uploaded. First-party analytics keeps counting events, but the visitor id `an_aid` isn't stored or sent until analytics consent, and those events carry `analytics_consent: "withheld"`. Everyone else sees no banner and is tracked as before. The GTM `<noscript>` iframe is gone, since it can't wait for consent. `openConsentSettings()` from `@agent-native/core/client/consent` reopens the banner.
