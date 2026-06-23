---
"@agent-native/core": patch
---

Feedback submissions now forward a `clientSurface` hint (web / electron / tauri)
alongside the existing page URL, so form owners can tell whether feedback came
from the Agent Native desktop app, a Tauri shell (e.g. Clips), or a browser.
Detection is exposed as a reusable `getClientSurface()` client helper and is
passed through as hidden metadata — it never appears as a visible form field.
