---
"@agent-native/core": minor
---

Add demo mode: a settings toggle / `toggle-demo-mode` agent action / `DEMO_MODE` env that deterministically replaces real names, emails, and numbers with realistic fake data in every action result — for both the UI and what the agent sees. IDs, dates, URLs, and structure are preserved (protect-first tokenization + key denylist) so the app keeps working. The redaction walk is fully gated and only runs when demo mode is on.
