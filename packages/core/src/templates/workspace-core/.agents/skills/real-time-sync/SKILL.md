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

While a collab doc shows another person present, the transport polls every
2.5 s instead (`acquireCollabPollBoost()`, held by the collab client, not by
pages). It is a no-op whenever a stream is connected, lapses after 3 minutes
without input or remote events, and never applies to lone tabs.

## Use the hook

Declare the reason beside the route gate so reviewers can see why the page pays
for remote sync:

```tsx
useDbSync({
  queryClient,
  realtime: isPrivateDeckEditorPath(location.pathname)
    ? { reason: "other collaborators can edit this deck while it is open" }
    : undefined,
  pauseWhenHidden: true,
});
```

The reason is required by the TypeScript API. `guard:realtime-opt-in` also
requires a named private or authenticated pathname predicate, and rejects
public/docs/SSR files and known anonymous routes. A reviewed exception must put
this pragma on the opt-in or the line immediately above it:

```ts
// guard:allow-realtime-opt-in — short reason
```

An opted-in page only hears about an action when its change event reaches the
current user. By default an `action` event reaches the actor alone, so a
collaborator's comment, save, or agent edit never arrives. Declare
`changeResource: (input, result) => ({ resourceType, resourceId })` on the
mutating action and the event also reaches everyone who can read that resource.
Name it from `input` when the call carries the resource id (Content's
`documentChangeResource`, Slides' comment actions) and from `result` when the
call is keyed by a child id (Design's `designChangeResource` for
`delete-file`); return `null` for a call that changed nothing. Do not publish a
parallel per-template event for the same purpose.

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

On local tool completion, `useDbSync()` advances the action counter and any
other raw-query source counters currently observed by the page. Generic tool
completion events do not identify their data domain, so keep raw-query source
lists narrow. Remote sync events advance their specific source counters.

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
