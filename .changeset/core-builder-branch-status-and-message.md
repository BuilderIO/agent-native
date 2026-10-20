---
"@agent-native/core": minor
---

New `getBuilderBranchStatus` and `sendBuilderBranchMessage` (exported from `@agent-native/core/server`) read the state of a Builder agent branch (agent state, last activity, archived or deleted, pull request status and URL) and send it a follow-up message. Both take an explicit `projectId`, never create a project, and fail with a typed `BuilderBranchError` whose `code` and `retryable` flag tell a missing branch, a rejected credential, a timeout, a rate limit, and an unreadable response apart.
