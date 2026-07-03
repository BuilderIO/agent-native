---
"@agent-native/core": minor
---

Collaborative editing kit: agent edits now behave like a visible collaborator
and undo is per-user everywhere.

- Agent presence lingers (~6s) after edits instead of vanishing instantly;
  any agent-sourced collab write (`applyText`, `searchAndReplace`, `applyJson`,
  `applyPatchOps`) automatically publishes presence plus lingering edit
  attribution — no per-action wiring required (`agentTouchDocument`).
- New `recentEdits` awareness convention with `useRecentEdits`,
  `publishRecentEdit`, and the `RecentEditHighlights` overlay — fading,
  name/avatar-flagged highlights over regions a human or the AI just edited.
- New shared per-user undo primitives: `useCollabUndo` (Y.UndoManager
  lifecycle with local-origin scoping) and `useLocalOpUndo` /
  `createLocalOpUndoController` (inverse-op undo for op-based apps that never
  reverts other participants' work).
- `CollabUser.avatarUrl` renders profile images in `PresenceBar`,
  `LiveCursorOverlay`, and `RemoteSelectionRings`; selection descriptors may
  now carry labels (`{ selector, label }`), and agent selection tags no longer
  render as "AI — AI".
- Presence now survives multi-instance/serverless deployments: awareness
  state is mirrored to a new `_collab_awareness` table (SQLite/Postgres
  portable, additive, best-effort with throttled writes), so cursors and the
  agent's presence written in one invocation are visible to clients polling
  any other instance.
