---
"@agent-native/core": patch
---

Brand transactional auth emails per app. Signup verification and password
reset emails now send from `<app-slug>@agent-native.com` with reply-to
hello@agent-native.com and per-app subjects/headings ("Verify your email for
Agent-Native <App>" / "Reset your Agent-Native <App> password"). The
verification email body also includes the app's one-line description (competitor
names reframed as "replacement"); the reset email omits the pitch since it's a
security email. Unknown apps fall back to the generic "Agent Native" branding
and the configured EMAIL_FROM sender.
