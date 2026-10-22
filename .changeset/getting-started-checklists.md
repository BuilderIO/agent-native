---
"@agent-native/core": patch
"@agent-native/toolkit": patch
---

Onboarding steps can belong to a named checklist. A step registered with `checklist: "getting-started"` and an `href` shows up only in a progress checklist read with `useOnboardingChecklist()` and rendered by the new `GettingStartedCard`, and never in the setup checklist. Dismissal is stored per checklist.
