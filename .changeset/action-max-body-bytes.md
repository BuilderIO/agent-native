---
"@agent-native/core": patch
---

Add an opt-in `maxBodyBytes` option to `defineAction`. When set, the action
HTTP route rejects oversize requests with 413 based on the declared
`Content-Length` BEFORE buffering or parsing the body.

This closes a gap for public, no-auth POST actions: previously the router parsed
the full JSON body before any in-`run()` size check, so a large anonymous
request could force parse work on an unauthenticated route. The check is
runtime-agnostic (header only), so it works on both the web-`Request.json()` and
Node `readBody` paths, and is unset by default so existing actions are
unaffected. The Plan template's public `validate-local-plan-source` action opts
in.
