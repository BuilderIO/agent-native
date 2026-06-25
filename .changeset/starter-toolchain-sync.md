---
"@agent-native/core": patch
---

Sync builder-agent-native-starter toolchain files (React Router config, Vite config, server plugins, etc.) alongside the manifest so dependency bumps from templates/chat do not leave the starter in a broken state. Standalone UI scaffolds re-declare tsconfig `paths` and `baseUrl` for `@/*` resolution; headless scaffolds omit `baseUrl` for TS 6 tsgo compatibility. Netlify post-process now rewrites unindented template build commands.
