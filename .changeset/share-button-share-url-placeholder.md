---
"@agent-native/core": minor
---

`ShareButton` now accepts an optional `shareUrlPlaceholder` prop. When the primary `shareUrl` is undefined the popover shows the placeholder inside a subtle dashed-border slot instead of hiding the link section silently. Use it to tell respondents _why_ there's no link yet (e.g. "Publish this form to get a public response link") so the popover doesn't look broken on draft / unpublished resources.
