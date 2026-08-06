---
"@agent-native/core": patch
---

Stop ending long agent chat turns early. The client's whole-turn follow budget was shorter than a single background chunk the server is allowed to run, so turns that were still streaming were cut off; it is now a backstop above the server's own limits, with a test pinning that order. Also explains the gateway's email-verification block instead of showing a dead-end error, and no longer claims a stopped turn was looping when it was still working.

Also require a provider key when an `ai-sdk:*` engine points at a public gateway. The keyless exemption was meant for a self-hosted gateway but accepted any `baseUrl`, so pointing at a hosted provider without a key sent an unauthenticated request that came back as `http_401` "Missing Authentication header" — a transport error naming the wrong cause, repeated on every retry. Only loopback, private-range, and `.local`/`.internal` hosts are exempt now.
