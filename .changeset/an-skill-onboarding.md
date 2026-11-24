---
"@agent-native/core": patch
---

The `an` skill that `skills add an` installs now names the jobs it covers (decks, docs, designs, email, calendar events, forms, dashboards and screen recordings), so hosts load it from a plain request. It picks the app from the request using what `list_apps` returns and says why an app may be missing from that list, tells a new user that one connector authorization covers every app and that each app signs in on its own, with Continue with Agent-Native where its sign-in page offers it, and names the one reconnect step per host for a dropped connection instead of a reinstall.
