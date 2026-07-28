---
"@agent-native/core": minor
---

**Breaking:** rename the `registerShareableResource` resolver `getShareEmailLogoUrl` (added in 0.125.0) to `getLogoUrl`. Update any registration that used the old name.

Add `getBrandName`, `getSender`, and `getHeroHtml` resolvers to `registerShareableResource`, plus an optional `heroHtml` on `renderEmail` and `fromName` on `sendEmail`. Share-notification emails can now render a template-owned preview block above the CTA (injected verbatim, so a template supplies its own markup — e.g. a video thumbnail with a play badge), override the brand name shown beside the logo, and appear to come from the sharing user ("Alice via Clips") with replies routed to them while keeping the configured domain-verified sending address so SPF/DKIM still pass.
