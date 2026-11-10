---
"@agent-native/core": patch
---

`agent-native --help` now says `--no-open` works with single-app `dev`, not only workspace dev. The "Create an App with an AI Agent" prompt starts the app with `pnpm dev --no-open`, so an agent that follows it no longer opens a browser tab the prompt tells it not to open.
