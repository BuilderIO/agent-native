---
"@agent-native/core": patch
---

Live collab updates now push over SSE to read-only viewer sharees, not just the
resource owner and org members. Collab events are tagged with their
resourceType/resourceId, and the per-user delivery filter runs an access-aware
(cached, fail-closed) check against the same `resolveAccess` authority used by
the collab routes — so a viewer with explicit access sees edits at push latency
instead of falling back to the poll cycle, while unauthorized users are never
delivered events.
