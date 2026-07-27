---
"@agent-native/core": patch
---

Brand transactional auth emails per app. Signup verification and password
reset emails now send from `<app-slug>@agent-native.com` with reply-to
agent-native@builder.io and per-app subjects/headings ("Verify your email for
Agent-Native <App>" / "Reset your Agent-Native <App> password"). The
verification email body also includes the app's one-line description (competitor
names reframed as "replacement"); the reset email omits the pitch since it's a
security email. Unknown apps fall back to the generic "Agent Native" branding.

The branded sender and reply-to are applied only when the configured
EMAIL_FROM is already on agent-native.com, so self-hosted deployments keep
their own verified sender and support mailbox.
