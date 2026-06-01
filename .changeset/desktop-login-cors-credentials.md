---
"@agent-native/core": patch
---

Fix desktop app login failing in dev with a CORS error
(`Access-Control-Allow-Credentials is not "true"`).

The desktop app logs in with `credentials: "include"`. In dev its origin
(`http://localhost:1420`) was matched by the embed-frame Vite middleware, which
answered the CORS preflight with `Access-Control-Allow-Origin` but no
`Access-Control-Allow-Credentials`. The browser then rejected the credentialed
login. The middleware now also sends `Access-Control-Allow-Credentials: true`
for origins allowed to use credentials, matching how production responds.
