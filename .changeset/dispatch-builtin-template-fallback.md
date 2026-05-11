---
"@agent-native/dispatch": patch
---

Dispatch's catch-all `/$appId` route now falls back to first-party template deploy URLs (e.g. `http://localhost:8084` for forms in dev, `https://forms.agent-native.com` in prod) when no workspace manifest is loaded. Previously, visiting `/forms` on hosted dispatch — or in framework dev where each template runs on its own port — forced the auth guard, then dropped the user on dispatch's "Page not found" pane after the post-login reload. Now the catch-all reads the built-in agent registry and redirects to the real app.
