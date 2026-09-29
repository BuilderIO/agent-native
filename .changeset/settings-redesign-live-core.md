---
"@agent-native/core": minor
---

The redesigned Settings is now the only Settings for every app, with no feature flag. `SETTINGS_REDESIGN_FLAG` is deprecated and no longer registered; `useFeatureFlag` and `useFeatureFlagState` read it as on, so apps generated from older templates that still check it keep the redesigned layout.
