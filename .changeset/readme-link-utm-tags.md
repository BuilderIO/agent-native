---
"@agent-native/core": patch
---

Tag the scaffold Docs card and onboarding links to agent-native.com with `utm_source=app`, and publish the npm README with `utm_source=npm` links. `docsUrl()` takes a `source` option, and `campaign: null` leaves `utm_campaign` off; otherwise it still defaults to `docs`.
