---
"@agent-native/core": patch
---

Sync builder-agent-native-starter toolchain files (React Router config, Vite config, server plugins, etc.) alongside the manifest so dependency bumps from templates/chat do not leave the starter in a broken state. Standalone scaffolds now re-declare tsconfig `paths` anchored to the app root for correct `@/*` resolution under TypeScript 6.
