---
"@agent-native/core": patch
---

Apps load in dev in Brave with Shields on. Brave's default cookie-notice list blocked a core module because its file name contained "consent-banner", so the app never got past its loading skeleton. The module now has a neutral name.
