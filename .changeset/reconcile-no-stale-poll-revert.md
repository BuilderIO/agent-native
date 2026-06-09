---
"@agent-native/core": patch
---

Stop a lagging content poll from briefly reverting a just-applied local edit in
the shared rich-markdown reconcile (`useCollabReconcile`).

When a structural edit (e.g. a Notion-style drag-to-columns) is applied locally
and the editor is then blurred — the drag grips the handle, not the prose, so
`isFocused` is false at drop time — a `get-visual-plan`/source poll that
re-supplies the older pre-edit content (older-or-equal `contentUpdatedAt`) was
applied through `setContent`, reverting the new layout. A moment later the save
round-tripped and the next poll restored it: the "drop works, then undoes, then
comes back" glitch.

The reconcile already dropped older-or-equal external content while focused (a
real peer/agent edit is always newer and retries). In NON-COLLAB editors there
is no peer, so older-or-equal content is ALWAYS a stale poll/echo — it is now
dropped regardless of focus (gated on having already seeded, so the first apply
still lands). Collab editors are unchanged: a peer edit arriving while you are
away still applies.
