---
"@agent-native/core": patch
---

Brand signup verification emails per app: the sender is now
`<app-slug>@agent-native.com`, the subject and heading read "Verify your email
for Agent-Native <App>", the body includes the app's one-line description, and
the reply-to is set to hello@agent-native.com. Unknown apps fall back to the
generic "Agent Native" branding and the configured EMAIL_FROM sender.
