---
"@agent-native/core": patch
---

Fix the sign-in entry subtitle promising a create-account control that the view
never renders. The magic-link entry view, the desktop identity gate, and the
mobile sign-in sheet all hide the Create account / Sign in tabs because one
email field both registers and signs in, so the subtitle now attaches both
outcomes to the visible continue action instead of advertising a separate step.
