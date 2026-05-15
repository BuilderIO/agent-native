---
"@agent-native/core": patch
"@agent-native/migrate": patch
---

Fix migration template dev-port collision (8100 → 8101), emit a single canonical for /docs and /docs/getting-started, and JSON-escape generated route paths so Next.js dynamic segments can't break scaffolded TSX.
