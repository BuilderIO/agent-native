---
"@agent-native/core": patch
---

Render one cacheable, session-independent app shell for normal page requests and gate private UI through `AppProviders` on the client. Explicit auth pages remain cached login documents, signed-in visitors redirect without cache-buster query loops, APIs/actions remain server-protected, and generated edge workers now enforce the same anonymous public-shell cache policy as Nitro and Netlify.
