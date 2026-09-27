---
"@agent-native/core": patch
---

Read the session once per page load and lower the per-request auth cost. The session bootstrap, analytics, `useSession`, and the beta-lane probe now share one signed-in answer, and a focus or visibility change inside that 30-second lifetime re-reads it when it expires if the tab is still focused. The identity-rekey probe and the `active-org-id` preference are cached per process for 15 seconds and dropped on writes; the preference is also keyed by an httpOnly org-selection cookie that every org switch rotates, so the switching browser reads its new org on every instance. The legacy cookie path reads its user row once. Storage secrets are fetched in one batch, `file-upload/status` detects each provider once, and the onboarding summary is shared across the components that show it and, like the upload status, waits until startup reads have finished.
