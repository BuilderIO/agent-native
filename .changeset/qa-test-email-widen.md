---
"@agent-native/core": patch
---

Suppress synthetic signup identities that were reaching production analytics.
`isQaTestEmail` only matched plus-addressed `+qa-test-bot-…@`, so bare
`qa-test-bot-…@`, `an-e2e-probe-…@e2e.agent-native.test` and `e2e-…@example.com`
were tracked as real users. Matching now covers those shapes plus the RFC 2606
reserved TLDs, and stays narrow enough that ordinary addresses — including bare
`example.com` fixtures and plus-addresses — remain trackable.
