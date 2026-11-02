---
"@agent-native/core": patch
---

Download first-party templates over HTTPS by fetching only the files they need instead of the whole-repository archive, cutting `create`, `add-app`, and `template sync` downloads from minutes to seconds. Downloads no longer need `git` installed, and they retry for ten seconds when GitHub is unavailable.
