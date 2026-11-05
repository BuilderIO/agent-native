---
"@agent-native/core": patch
---

Google Analytics, Google Tag Manager and a deployment's head script no longer load on a page whose URL holds an agent link's token, including the sign-in page such a link redirects to. These tags send the page's URL to their vendors, and the token grants read access to whoever has it.
