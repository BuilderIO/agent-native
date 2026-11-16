---
"@agent-native/core": patch
---

Google Analytics, Google Tag Manager and a deployment's head script no longer load on a page whose URL holds a signed link's token (an agent link, an embed link or a Clips intake link), including the sign-in page such a link redirects to and URLs that percent-encode the parameter's name. These tags send the page's URL to their vendors, and the token grants access to whoever has it.
