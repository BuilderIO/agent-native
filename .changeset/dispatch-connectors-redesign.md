---
"@agent-native/dispatch": minor
---

feat(integrations): redesign the Integrations page as service-grouped Connectors. The page now groups by credential key (OpenAI, Stripe, Slack, …) across every app in the workspace, and the new Connect dialog creates the vault secret, grants it to every app that wants it, and syncs in one flow. Old per-app progress cards and individual integration rows are replaced by a flat list of providers with their connect status.
