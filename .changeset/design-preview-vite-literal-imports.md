---
"@agent-native/core": patch
---

Harden opaque Design preview resource authentication against escaped URLs, external bases, and import-map redirects; authenticate bridge-local Vite computed imports. Preview frames now block external scripts to prevent credential leakage.
