---
"@agent-native/core": patch
---

Make the document Report-Only script-src CSP account for the framework-injected Google Analytics / Tag Manager loader and inline gtag config script, so GA no longer triggers a CSP violation on every page load (it was Report-Only, so GA was never actually blocked) and the policy stays safe to graduate to enforcement.
