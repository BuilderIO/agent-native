---
"@agent-native/core": patch
"@agent-native/creative-context": patch
"@agent-native/recap-cli": patch
---

Stop a second Chromium from being downloaded alongside the one already on disk.

First-party workspace packages now take Playwright from an exact catalog pin, so
a caret cannot resolve forward to a release tied to a different Chromium
revision. The two packages that declare Playwright as a published optional
dependency — `@agent-native/creative-context` and `@agent-native/recap-cli` —
deliberately keep a caret range instead: an exact range in a library stops a
consumer who already has a different Playwright from deduping, which forces a
nested copy and downloads exactly the second browser this change exists to
avoid.
