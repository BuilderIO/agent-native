---
"@agent-native/core": patch
---

Initialize Sentry inside the Nitro server so 5xx errors thrown by framework routes, action handlers, and agent-chat streams are reported with per-request user context. Driven by the `SENTRY_SERVER_DSN` env var (no-op when unset). Complements the existing CLI and browser Sentry init points without wiring them together — each maps to a different Sentry project.
