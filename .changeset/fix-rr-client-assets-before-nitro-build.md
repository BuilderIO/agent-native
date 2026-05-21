---
"@agent-native/core": patch
---

Fix `/assets/*` 404s in production builds. The React Router client build is now
copied into Nitro's `publicDir` before `nitroBuild` runs, so the static-asset
manifest baked into the server bundle includes hashed JS/CSS chunks. Previously
the copy happened after `nitroBuild`, leaving the files on disk but invisible to
Nitro's runtime `serveStatic` handler — every `/assets/*` request fell through
to the SSR catch-all, which 404s any path with a file extension.
