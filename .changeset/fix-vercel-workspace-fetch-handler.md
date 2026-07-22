---
"@agent-native/core": patch
---

Fix Vercel workspace serverless functions crashing on every request. The generated Vercel function wrapper now exports the `{ fetch }` web-handler shape so Vercel invokes it web-style with a Web `Request`, and requires a Web `fetch` handler from `main.mjs` rather than forwarding a Web `Request` to a Node-style `(req, res)` handler (fixes #2324).
