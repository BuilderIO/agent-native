---
"@agent-native/core": patch
---

Let native chat agents author up to three contextual follow-up suggestions within the existing agent run, without a separate suggestion-generation service. Validate and publish quiet, run-scoped suggestion metadata only on successful completion; suppress it on interruption, pending approval, run-boundary continuation, or rejected responses. Independent harness runtimes without a structured follow-up contract do not synthesize suggestions.

Evaluate follow-ups in the interactive run's shared instructions. Save suggestions and canonical run status in the existing thread snapshot on server completion, including when the client is disconnected. Clear stale suggestions on new submissions and unsuccessful turns, and preserve completed results and richer client progress during snapshot merges.
