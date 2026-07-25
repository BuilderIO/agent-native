---
"@agent-native/creative-context": patch
---

Declare `@tanstack/react-query` as a peer/dev dependency so `tsc` can name its types under pnpm's isolated layout. Without it the package fails to build with TS2883 in a generated workspace, which breaks the root `postinstall` and therefore `pnpm install`.
