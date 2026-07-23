---
"@agent-native/core": patch
---

Update Builder design-system indexing to call the current `/design-systems/v1/index`
endpoint with a structured `sources` array (uploaded files, public repos, connected
projects) instead of the retired `generate` endpoint and its flat `uploads` payload.
File selections are now attached per source, and the incomplete-response guard only
requires a `designSystemId`. "Open in Builder" now links into the actual
project/branch (`branchUrl`) when the service returns one, falling back to the
design-system-intelligence docs URL.
