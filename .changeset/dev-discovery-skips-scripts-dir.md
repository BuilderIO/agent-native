---
"@agent-native/core": patch
---

Dev agent chat no longer imports every file in an app's `scripts/` folder while discovering actions. A CLI script with side effects at the top level, such as one that closes the database, used to run on every `pnpm dev` boot. Put actions in `actions/`.
