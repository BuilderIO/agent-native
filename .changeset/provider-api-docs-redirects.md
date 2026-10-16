---
"@agent-native/core": patch
---

`provider-api-docs` now follows redirects (301, 302, 303, 307, 308) when it fetches a public documentation page, up to 5 hops, instead of failing with the redirect status. Each hop's `Location` must be an http(s) URL that passes the same private-address check as the first URL before it is fetched, and docs fetches still send no credentials. A redirect loop, more than 5 hops, a redirect without a `Location`, or a blocked hop fails with a `provider_docs_redirect_*` error code that names the reason. The result's `request.finalUrl` reports where the content came from, and links in the extracted content resolve against it. Credentialed `provider-api-request` calls still never follow redirects.

Provider responses without a `Content-Length` header are now read up to the byte cap and the rest is counted but not kept, so a large body can no longer force an unbounded allocation.
