---
"@agent-native/core": minor
---

Add an optional `heroHtml` to `renderEmail`, plus `getShareEmailHeroHtml` and `getShareEmailBrandName` resolvers on `registerShareableResource`. Share-notification emails can now render a template-owned preview block above the CTA — injected verbatim so a template supplies its own markup (e.g. a video thumbnail with a play badge) — and override the brand name shown beside the logo (e.g. the sharing org's name) instead of always using the app name.
