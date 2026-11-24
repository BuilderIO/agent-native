---
"@agent-native/core": patch
---

The `an` skill that `skills add an` installs now names the jobs it covers (decks, docs, designs, email, calendar events, forms, dashboards and screen recordings), so hosts load it from a plain request. It picks the app from the request using the app names and descriptions `list_apps` returns, tells a new user that one connector authorization covers every app and that each app signs in with Continue with Agent-Native, and names the one reconnect step per host for a dropped connection instead of a reinstall.
