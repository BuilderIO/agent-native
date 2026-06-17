---
"@agent-native/core": patch
---

Docs: document the agent-runtime features added since the first docs sweep.
New pages: Human-in-the-Loop Approvals (`needsApproval` gate + `approval_required`
/ `approvedToolCalls` flow), Observational Memory (background three-tier
compaction with `AGENT_NATIVE_OM_*` config), In-Loop Processors (the
`processOutput*` guardrail seam + `TripWire` / `tripwire` event), and Durable
Resume (tool-call journal — prompt note + tool-layer hard-block against
re-running completed side effects). Folded action `outputSchema` /
`outputErrorStrategy` and the `needsApproval` gate into the Actions page, and
added an optional OpenTelemetry-spans section to Observability. All wired into
the docs sidebar nav; no runtime behavior changes.
