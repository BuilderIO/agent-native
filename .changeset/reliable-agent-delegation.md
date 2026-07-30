---
"@agent-native/core": patch
"@agent-native/dispatch": patch
---

Make cross-app delegation ask the receiving specialist agent by default, keep
typed remote terminal states intact, retry idempotent transient transport
failures, prevent recursive agent cycles, and bound delegated context growth.
Proven durable-background delegated runs also keep the full bounded
continuation allowance while sharing one cumulative wall-clock deadline, so a
slow successful child task cannot strand its caller before the caller finishes
its own tool work. After a provider exhausts its short in-call 429/529 retry
budget, a proven background delegation now gets one cooled-down continuation,
with a hard cap that prevents sustained throttling from becoming a request
storm.

Receiving agents keep ownership of source selection, schema interpretation,
queries, joins, and their local tools. Direct read actions remain available for
exact bounded contracts, but are no longer advertised as a workaround for an
unreliable agent call.

Dispatch now opts into the same durable background run contract it emits at
deploy time, so delegated control-plane work is not cut off by the foreground
40-second budget while already running in the 15-minute worker.

Workspace vault ciphertext now prefers the workspace A2A-derived encryption
key over each app's independent auth secret. Existing app-auth-encrypted rows
remain readable by their owning app and are compare-and-swap migrated on read,
so sibling agents can reliably resolve the same organization credentials
without exposing or copying their values. Automatic engine selection also
pairs the chosen provider with that provider's credential instead of reusing
an active key proven to belong to another provider, while preserving opaque
explicit caller keys.

Deployments can set `WORKSPACE_SECRETS_ENCRYPTION_KEY` to decouple shared vault
ciphertext from A2A trust rotation without changing app-local OAuth encryption.
`WORKSPACE_SECRETS_ENCRYPTION_KEY_PREVIOUS` provides a safe re-encryption
window when that dedicated workspace key itself rotates.

Slides deck creation now accepts an omitted optional `slides` list as an empty
deck, matching the action schema advertised to delegated agents.

A2A transport hints are now structurally tagged so receiver intent classifiers
do not mistake framework guidance such as "full transcripts" or "create a
dashboard" for the caller's objective. Analytics strips both the tagged form
and legacy hints, and delegated agents now default to a grounded partial answer
instead of bouncing safe source, filter, or workflow choices back to callers.

Documentation now distinguishes framework Core, optional Toolkit, and optional
Templates, and makes source editing an explicit workspace/write-tool capability
rather than assuming every embedded agent has filesystem access.
