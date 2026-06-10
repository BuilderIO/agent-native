---
"@agent-native/core": minor
---

Add Presence Kit: Liveblocks/Figma-grade live-cursor and selection primitives.

- **Fast awareness**: `useCollaborativeDoc` now POSTs awareness state changes within ~150ms (throttled trailing edge) instead of waiting for the 2s poll cycle. The `postAwareness` server handler emits an `AWARENESS_CHANGE_EVENT` that is forwarded through the `/_agent-native/poll-events` SSE stream to connected peers push-style. Polling-only deployments degrade gracefully to poll cadence.
- **`usePresence(awareness, localClientId)`**: reactive hook that derives `OtherPresence[]` from awareness state. The agent (AGENT_CLIENT_ID) appears as a first-class participant with `isAgent: true`. Returns `setPresence(partial)` to publish arbitrary presence fields (cursor, selection, viewport).
- **`LiveCursorOverlay`**: absolutely-positioned overlay that renders remote users' cursors from normalized 0–1 coordinates. The agent cursor uses a sparkle icon. Cursors fade out after 10s of inactivity with 120ms CSS transitions.
- **`RemoteSelectionRings`**: renders colored outline rings + name tags over remotely-selected DOM elements using a `resolveRect` callback.
- **`useFollowUser`**: invokes a callback when the followed participant's viewport changes, enabling follow-the-cursor navigation.
- **`PresenceBar`** extended with `onAvatarClick` and `followingEmail` props for follow-mode UI with a blue ring indicator.
- **`toNormalized` / `fromNormalized`**: coordinate helpers for converting pointer events to/from normalized presence coordinates.
- **`getAwarenessEmitter` / `emitAwarenessChange` / `AWARENESS_CHANGE_EVENT`**: low-level emitter API for server-side awareness events.
- Design template (`templates/design`) wired as the flagship consumer: live cursors over the canvas, avatar follow mode, and agent cursor plumbing in `edit-design` / `generate-design` actions.
