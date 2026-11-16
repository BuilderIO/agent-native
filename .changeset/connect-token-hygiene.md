---
"@agent-native/core": patch
"@agent-native/skills": patch
---

`agent-native connect` rejects a `--scope` other than `user` or `project` (a typo like `usr` used to write the project file for `connect` and the user file for `connect dev`), warns and adds the file to `.gitignore` when a token is written at project scope, and accepts `--token-stdin` so the token stays out of shell history (`--token` now warns). New MCP config files and the connect profile file are created owner-only (`0600`), and the temporary file no longer exists at a wider mode while a token is written, in `@agent-native/core` and `@agent-native/skills`.
