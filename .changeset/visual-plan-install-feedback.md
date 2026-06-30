---
"@agent-native/core": patch
---

Harden the app-backed skill installer for visual-plan feedback: built-in skill folders now stage writes before replacing existing installs, include first-time install command metadata, and make `skills update` point first-time users to `skills add` for setup and MCP registration.
