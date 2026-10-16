---
"@agent-native/core": patch
---

Onboarding role analytics now include the typed "Other" answer as `role_text` on `onboarding.role_selected` and `onboarding_first_run_adopted`, capped at 80 characters with emails, links, handles and phone-like numbers replaced by placeholders. `onboarding_first_run_adopted` now reports `role` as the listed category instead of the raw answer.
