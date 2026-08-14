---
"@agent-native/core": patch
---

Hide `x-cloak` content in the extension iframe shell until Alpine boots.
Extension content is a body snippet, so it cannot define the rule itself: an
`x-cloak` overlay painted over the whole extension until the deferred Alpine
CDN script resolved, and permanently when it failed to.
