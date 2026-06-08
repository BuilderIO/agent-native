---
"@agent-native/core": patch
---

Constrain `@assistant-ui/store` (`>=0.2.9 <0.2.14`) and `@assistant-ui/tap` (`^0.5.14`) as direct dependencies so the breaking `store@0.2.14`/`tap@0.6.0` combination can't be selected transitively via `@assistant-ui/react@^0.12.x`. This prevents the `./react-shim` / `./react` export resolution failures during Vite dependency pre-bundling and production builds.
