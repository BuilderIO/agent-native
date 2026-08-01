---
"@agent-native/core": patch
---

Store uploaded files in Cloudflare object storage instead of SQL. The
file-upload registry gains a built-in Cloudflare R2 provider: build with
`CLOUDFLARE_R2_BUCKET_NAME` and the generated `wrangler.json` carries the
`UPLOADS` binding it reads, `CLOUDFLARE_R2_PUBLIC_BASE_URL` supplies the public
base URL, and only that URL and the object key reach SQL. The provider reports
itself unconfigured on every other host, so no other deploy's provider order
changes.

On a Worker, "no provider configured" can no longer mean "use the SQL
fallback". There is no filesystem there, so the fallback was a raw payload in a
thread row reported as a normal upload. `uploadFile` now throws with the setup
step instead, an absent bucket is distinguished from a bound-but-unusable one,
and the chat-attachment pre-upload no longer absorbs that failure — a swallowed
one is exactly what put the base64 in SQL.
