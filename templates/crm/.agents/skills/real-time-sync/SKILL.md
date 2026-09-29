---
name: real-time-sync
description: >-
  Decide whether a page needs external changes before refresh, then use the
  opt-in shared SSE and polling transport safely.
scope: dev
metadata:
  internal: true
---

# Real-Time Sync

## Decision rule

Opt in only when both are true:

1. The data can change without the current user acting.
2. The user needs to see that change before refreshing or navigating.

A local agent edit does not meet this rule. The chat run stream already
invalidates action queries and source counters after each side-effecting tool
and again at run end, without opening a background poll.

### Opt in

- **Slides deck editor:** another collaborator can edit the open deck.
- **Mail inbox:** new mail can arrive while the inbox is open.
- **A watched job:** a background job changes progress while the user watches it.
- **Cross-tab state:** state must converge across this user's open tabs without a
  new action.

### Keep it off

- Public, anonymous, marketing, docs, and SSR pages.
- Settings, forms, and read-mostly lists or dashboards. Refresh them on focus or
  navigation instead.
- Single-user agent edits. The chat run stream handles those.
- Pages where an update is useful eventually but not before the next refresh.

## Cost and behavior

`useDbSync()` has no background transport unless the page opts in with a
non-empty reason. One transport is shared per tab. A visible opted-in tab polls
at 1 minute, then 2, then 5 minutes while idle; user activity or a local
mutation resets that sequence. Hidden tabs pause by default. During an active
agent run, opted-in sync can poll at its configured `interval`; local tool
completion and run-end invalidation do not depend on that poll.

On a long-lived host, same-process changes stream over
`/_agent-native/events`; polling is the cross-process fallback. On a production
serverless host, the local events endpoint refuses the long-lived stream and
`/_agent-native/poll` carries remote changes. The paid Hosted Realtime Sync
Gateway is not required for this pattern.

## Use the hook

Declare the reason beside the route gate so reviewers can see why the page pays
for remote sync:

```tsx
useDbSync({
  queryClient,
  realtime: isDeckEditorPath(location.pathname)
    ? { reason: "other collaborators can edit this deck while it is open" }
    : undefined,
  pauseWhenHidden: true,
});
```

The reason is required by the TypeScript API and by `guard:realtime-opt-in`.
The guard checks only added lines, rejects public/docs/SSR paths, and requires a
pathname-gated opt-in. A reviewed exception must put this pragma on the opt-in
or the line immediately above it:

```ts
// guard:allow-realtime-opt-in — short reason
```

Do not start `subscribeSyncEvents()` or an `EventSource` in a feature to bypass
the decision. `subscribeSyncEvents()` is a lower-level transport subscription
used by the existing Yjs collaboration client and narrow framework plumbing.
Keep Yjs collaborative editing on its existing channel.

## Query freshness

Prefer `useActionQuery()` for action-backed data. Mutating actions refresh local
action observers; the chat run stream also invalidates them for agent tool
side effects. Raw queries should include the relevant source counters:

```tsx
const versions = useChangeVersions(["dashboards", "action"]);
useQuery({
  queryKey: ["dashboard", id, versions],
  queryFn: () => fetchDashboard(id),
  placeholderData: (previous) => previous,
});
```

That covers local chat-run edits. Remote edits reach the counter through
`useDbSync()` only on an opted-in page. Use `useReconciledState` when a form or
inline editor copies a query value into local state so incoming data does not
replace active typing.

URL commands (`__set_url__`, `set-url`, and `set-search-params`) and
`refresh-screen` also flow through local chat events. The sidebar listens for
screen refresh only while its panel is open or a chat run is active; public docs
can disable that boundary with `screenRefreshEnabled={false}`.

## Source counters

| Source | Changed by |
| --- | --- |
| `action` | A successful mutating action or local chat-run side-effect completion |
| `app-state` | Writes to `application_state`, including URL commands |
| `settings` | Writes to `settings` |
| `dashboards`, `analyses`, `extensions` | Domain-specific mutations that emit those sources |
| `collab` | Yjs collaborative document updates |
| `screen-refresh` | The explicit `refresh-screen` agent tool |

Use `useChangeVersions()` when one query depends on more than one source.

## Avoid

- Do not create manual polling loops or a second `EventSource`.
- Do not enable background sync for a whole app root when only one private
  route needs remote updates.
- Do not assume a successful local action is a reason for a background
  subscriber; use local mutation invalidation and the chat run stream.
- Do not blanket-invalidate template queries when a source-versioned query or
  action-backed query can target the refreshed data.
