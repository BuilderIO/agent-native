---
"@agent-native/core": patch
---

A saved Lab choice can be cleared: `set-lab` takes `enabled: null` (and `setUserLabStates` takes `null`), so the Lab follows its legacy flags or its default again, and any later rollout with them. `useLab` with a bare key now reads as off once the Lab states fail to load, instead of staying on; a definition still reads as its `defaultEnabled`. `@agent-native/core/feature-flags` exports `evaluateFeatureFlagStrict`, for gates that must tell an unreadable flag apart from Off.
