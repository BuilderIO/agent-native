---
"@agent-native/core": patch
---

Enable Rolldown lazy barrel loading in app builds on Vite 8. Named imports from side-effect-free barrel packages such as `@tabler/icons-react` no longer make the bundler parse every re-exported module: on the starter this cuts the React Router build from about 15,500 parsed modules to about 1,300, peak memory by about 45%, and build time by more than half, with identical output. Apps can opt out with `build.rolldownOptions.experimental.lazyBarrel: false`. Apps still on Vite 7 build as before: Vite 7 doesn't read `build.rolldownOptions`, so they don't get this improvement.
