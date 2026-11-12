---
"@agent-native/core": patch
---

`agent-native start`, and `agent-native identity rekey` in an app without `server/plugins/db.ts`, now run on Windows when Node is installed in a folder with a space in its name, such as the installer's default `C:\Program Files\nodejs`. Both started Node through cmd.exe, which split its path at the space and failed with `'C:\Program' is not recognized as an internal or external command`. The CLI now starts its own Node directly and keeps cmd.exe for shims like `pnpm`.
