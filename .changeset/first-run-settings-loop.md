---
"@agent-native/toolkit": patch
"@agent-native/core": patch
---

Choosing "Open AI key settings" in first-run onboarding now opens the settings page in standalone apps instead of starting the questionnaire again at step 1. The startup gate's context is shared even when the dev server loads its module twice, and every onboarding hook hears when first run is completed.
