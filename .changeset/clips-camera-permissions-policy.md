---
"@agent-native/core": patch
---

Relax the default `Permissions-Policy` from `camera=()` to `camera=*` so media-capture UI is no longer blocked at the policy level. `camera=()` disabled the camera for the page **and every iframe inside it**, which broke same-page recording UI and the Clips browser extension's camera bubble (injected as a cross-origin iframe, so it can't be re-enabled per-frame). Microphone stays `self`, geolocation and wake-lock stay disabled, and the browser still gates actual camera/mic use behind a per-origin permission prompt — this only removes the policy-level block, not user consent.
