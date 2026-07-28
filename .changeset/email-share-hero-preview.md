---
"@agent-native/core": minor
---

Add an optional `heroHtml` to `renderEmail` and a `getShareEmailHeroHtml` resolver on `registerShareableResource`. Share-notification emails can now render a template-owned preview block above the CTA — injected verbatim so a template supplies its own markup (e.g. a video thumbnail with a play badge) without the generic share action needing any app-specific rendering.
