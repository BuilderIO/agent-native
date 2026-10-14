---
"@agent-native/core": patch
---

`provider-api-request` now asks for approval before any request that can change provider data. GET, HEAD, and POST endpoints a provider documents as read-only (such as HubSpot search, Gong call listings, Notion queries, and GA4 reports) still run without a prompt. Sandbox `run-code` evaluates approval gates per call, so `providerFetch` reads keep working and writes are rejected with a pointer to the direct tool.
