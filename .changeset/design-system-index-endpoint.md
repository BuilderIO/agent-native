---
"@agent-native/core": patch
---

Update Builder design-system indexing to call the current `/design-systems/v1/index`
endpoint with a structured `sources` array (uploaded files, public repos, connected
projects) instead of the retired `generate` endpoint and its flat `uploads` payload.
File selections are now attached per source, and the incomplete-response guard only
requires a `designSystemId`. "Open in Builder" now links into the actual
project/branch (`branchUrl`) when the service returns one, falling back to the
design-system-intelligence docs URL. When `/index` returns only a `jobId`, the
Fusion branch URL is read from `GET /design-systems/v1/decode-jobs/:jobId/status`
(exposed as `fetchBuilderDesignSystemDecodeJobStatus`) so "Open in Builder" lands
on the branch. Large files (notably `.fig`) now stream to
storage in 16 MiB resumable chunks with retry and offset recovery instead of a
single unbounded request body. Indexing is split into `startBuilderDesignSystemUpload`
(opens signed resumable-upload slots) and `indexBuilderDesignSystem` (finalizes from
resolved sources) so browsers can stream `.fig` bytes straight to storage and never
hit the serverless request-body cap; `startBuilderDesignSystemIndex` still handles
small in-memory server-side payloads. Also exports `builderProjectBranchUrl`.
