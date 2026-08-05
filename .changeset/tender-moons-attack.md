---
"@agent-native/core": minor
---

`renderEmail` accepts a `footerLink`, so a footer can point at a real
destination. A `{link}` token in `footer` becomes an anchor in the HTML part and
`label (url)` in the plain-text part.

Notification emails now render through `renderEmail` instead of a bare
paragraph pair, so they carry the same branding as the rest of the framework's
mail. A sender can name the surface that controls the notification with
`metadata.emailFooter`, `emailFooterLinkLabel`, and `emailFooterLinkUrl`;
notifications that name none get no footer, so env-configured ops recipients
are never told to turn off a toggle they do not have.
