---
"@agent-native/core": patch
---

Read the session once per page load and lower the per-request auth cost. The session bootstrap, analytics, `useSession`, and the beta-lane probe now share one signed-in answer, and focus or visibility changes re-read it only once it is 30 seconds old. The identity-rekey probe and the `active-org-id` preference are cached per process for 15 seconds and dropped on writes, and the legacy cookie path reads its user row once. Storage secrets are fetched in one batch, `file-upload/status` detects each provider once, and the onboarding summary is shared across the components that show it and, like the upload status, waits until startup reads have finished.
