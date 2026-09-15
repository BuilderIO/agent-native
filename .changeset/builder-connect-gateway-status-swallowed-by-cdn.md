---
"@agent-native/core": patch
---

Fix "Create and activate" in the Builder.io free-credits onboarding step showing a Cloudflare "Bad gateway" page instead of the real failure. When Builder account provisioning failed, `/_agent-native/builder/connect` answered with its rendered error page under HTTP 502. Cloudflare replaces an origin 502/504 body with its own branded gateway page, so neither the human-readable reason nor the `builder-connect-error` BroadcastChannel handoff ever reached the browser — the popup showed a bare gateway error and the opener's polling loop kept spinning with no retry path.

Upstream Builder failures in this flow now report `BUILDER_UPSTREAM_FAILURE_STATUS` (503), which CDNs pass through intact. `sendBuilderPopupErrorPage` is now the one way to emit a connect/callback popup error page and clamps 502/504 via `cdnSafeOriginStatus`, so a future call site cannot reintroduce a status the CDN swallows. The preview-relay callback and the Builder waitlist route carried the same defect and are fixed with it.
