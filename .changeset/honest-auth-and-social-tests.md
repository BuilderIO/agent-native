---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Tighten test-only assertions for the dev auth secret, the social image cache buster, and the Dispatch auth plugin so they fail when the behavior they name breaks. No runtime change.
