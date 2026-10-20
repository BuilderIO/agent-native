---
name: factory-workflows
description: >-
  How to build, connect, dry-run and enable a Factory workflow from chat: the
  recipe, graph shape, `{{ }}` paths, item shape, and the connect protocol. Use
  whenever the user asks Factory to automate something (a digest, routing, a
  nudge, a follow-up, "every weekday at 9 post ... to Slack") or to edit, run,
  enable, connect or fix a workflow.
---

# Factory workflows

A workflow is a graph the scheduler runs: a Trigger says when, a Source brings
items in, other nodes read, decide and write, and an End closes each item.
Factory automates work this way. `create-factory-automation` is only for the
retired scheduled agent jobs such as PR governance, never for a new request.

## Recipe, in this order

1. **Find the factory.** `view-screen` gives the open factory and workflow.
   No factory yet: `list-factories`, then `create-factory`.
2. **Ask for what is missing, in one message.** Never guess these:
   - the repository as `owner/name`, for any GitHub step
   - the time zone (IANA, such as `America/New_York`) for daily, weekday and
     weekly schedules; without one the save fails with `schedule_timezone_required`
   - the Slack channel id, such as `C0123ABCD`. A `#channel` name is not an
     id: ask for the id in this same message, not in a later one.
3. **Read the catalog in two calls.** `describe-workflow-node-catalog` with
   `view: "index"` returns connection status, the graph shape, every node kind
   with its ports and a `settingsShape`, and one line per operation. Then one
   call with `operationIds: [...]` for the full fields of the operations you
   use. Read a kind's full schema (`kind: "source"`) only when its shape is not
   enough. The unfiltered call is too big for one tool result.
4. **Save the whole graph.** `save-factory-workflow` with `factoryId`, `name`
   and `graph` (JSON text, see "Graph shape") creates it, disabled. A bad graph
   fails with `graph_invalid` and one line per problem,
   `code @ node x port y: detail`, all at once: fix them all, then save again.
   Nothing is saved on a failure.
5. **Read `connections` in the save result.** Each entry is a provider the
   graph needs: `status` is `connected`, `not connected` or `unknown`, and
   `nodes` are the node ids that need it. Call `request-workflow-connection`
   for each one that is `not connected`. See "Connecting".
6. **Dry run.** `run-factory-workflow` with `mode: "dry"` and `waitSeconds: 25`.
   See "Dry run loop".
7. **Enable.** Only after a clean dry run of the current version and every
   provider connected. First say what will start happening: what runs when, and
   what it sends, writes or merges. Then call `set-factory-workflow-enabled` with
   `enabled: true`. It stops for the user's approval in chat, and the approval
   card names the tool and its arguments, not what they mean, so your sentence is
   what they decide on. Until they approve, the workflow is off and nothing was
   enabled. If they decline, say it stays off; do not ask again unless they do.
8. **Tell the user**, once the enable call has returned, what runs when, what
   it reads and writes, which integrations are connected, and that the first
   live run is the schedule. Creating a workflow from chat opens its canvas (`navigated: true`). When
   `navigated` is false, call `navigate` with the result's `canvasPath`.

Saving into an enabled workflow switches it off (`disabledBySave: true`): the
new version needs its own dry run. Updating needs `workflowId` and the
`expectedVersion` you read; a stale one fails with `version_conflict`. Read it
again with `get-factory-workflow` before editing: the user may have changed it.

## Graph shape

```
{ nodes: [{ id, name, kind, position: {x, y}, settings }],
  edges: [{ id, from: { node, port }, to: { node } }],
  settings: { timezone?, extras? } }
```

Send this object to `save-factory-workflow` as JSON text in `graph`: one string,
quotes escaped. A parse failure names the position: fix it and send again.

- `id` is a slug (letters, digits, `-`, `_`). `name` is an identifier (letters,
  digits, `_`, no spaces) and is how later nodes read this one: `nodes.<name>`.
  Reusing the id as the name is fine. Space `position.x` by 344.
- Exactly one `trigger`, with no inputs. Every output port must lead to a node,
  or the save fails with `port_leads_nowhere`.
- Ports: `trigger`, `source`, `lookup`, `action`, `combine`, `split`, `ai`,
  `agent` have `out`. `filter` has `match` and `otherwise`. `switch` has
  `route:<route id>` for each route and `otherwise`. `wait` has `replied` and
  `timedOut` (reply), `done` (time), `met` and `timedOut` (condition). `end` has
  none.
- Trigger schedules: `{every: "5m"|"10m"|"15m"|"30m"|"60m"}`, `{daily: {at}}`,
  `{weekdays: {at}}`, `{weekly: {day: 0-6, at}}`, `at` as 24-hour `HH:MM`.
  Put `timezone` on the trigger's settings.
- Workflow `settings.extras` holds free-form values a node reads with a path,
  such as the repository and the channel id. Put them there so a person can
  change one place.
- **A Source's scope lives on the Source node.** For an `inbox-poll` source,
  `filter.scopes[0]` is the Slack channel id, the GitHub repo (`owner/name`) or
  the Sentry project (`org/project`), one per workflow. `save-triage-config` is
  only a fallback; do not rely on it.

## Binding values and `{{ }}` paths

A node's `args` map each field to a binding. A bare string is rejected.

- `{ "mode": "path", "path": "item.title" }`: read a value (no braces).
- `{ "mode": "fixed", "value": "..." }`: a literal. A string may embed holes,
  `"Review {{ item.title }}"`; a string that is one hole keeps its type.
- `{ "mode": "ai", "instruction": "..." }`: the model writes this one field
  from the incoming item. Never for a JSON field, and not on a Source.
- Recipients and targets (who or where an effect lands: email recipients, a Slack
  channel or user, a Builder project or branch, a GitHub repo or PR number) come
  from fixed values, workflow settings, item fields or earlier lookups, never an
  AI step's output; the save refuses it with `model_written_target`.

A path is `root.field.field[0]`: names and `[0]` indexes only, no calls or
operators. Roots:

| Root | Reads |
| --- | --- |
| `item` | the item at this node (shape below), plus `item.id` |
| `nodes.<name>` | the output a node upstream attached (a Lookup's `into` renames it); a node that is not upstream fails with `bad_reference` |
| `settings` | the workflow settings, such as `settings.extras.repository` |
| `run` | `id`, `mode`, `startedAt`, `scheduledFor`, `windowStart`, `windowEnd` |
| `loop` | `iteration`, `max`, inside a loop only |

A Source runs before any item exists, so its args read only `settings` and
`run`. A missing value fails the item with `expression_failed`; it never
renders blank.

## Item shape

What flows between nodes: `id`, `kind` (`message`, `issue`, `pull_request`,
`commit`, `call`, `lead`, `ticket`, `alert`, `error`, `spike`), `provider`,
`title`, `text`, `url`, `author`, `occurredAt`, `thread` (`channelId`,
`threadTs`, `repo`, `number`, `ticketId`), `extras` (provider fields, such as
`extras.sha`) and `payload`. A pull request has `item.thread.repo` and
`item.thread.number`.

`combine` turns many items into one. Mode `list` gives `{ items, count,
truncated, totalAvailable }`, and with nothing to combine it still gives one item
with `count: 0`, so a quiet day can say so. Rules in `filter` and `switch` are
`{ left: "<path>", op, right }` with `op` one of `equals`, `notEquals`,
`contains`, `startsWith`, `isEmpty`, `isTrue`, `inList`, `gt`, `lt`, `between`,
`olderThan`, `pastDue`; `isEmpty`, `isTrue` and `pastDue` take no `right`.

## Worked example: a weekday digest

"Every weekday at 8, send the team a summary of what changed in the repo."
Trigger, a window Source over commits, one list, one AI-written Slack post, End.
This is the shipped story graph (`server/workflow/stories/03-morning-digest`),
with the repo and channel in `settings.extras`:

```json
{
  "nodes": [
    {"id": "weekdays8", "name": "weekdays8", "position": {"x": 0, "y": 0}, "kind": "trigger", "settings": {"schedule": {"weekdays": {"at": "08:00"}}, "timezone": "America/New_York"}},
    {"id": "commits", "name": "commits", "position": {"x": 344, "y": 0}, "kind": "source", "settings": {"source": "window", "operation": "github.listCommits", "args": {"repo": {"mode": "path", "path": "settings.extras.repository"}}, "maxItems": 100}},
    {"id": "digest", "name": "digest", "position": {"x": 688, "y": 0}, "kind": "combine", "settings": {"mode": "list"}},
    {"id": "post", "name": "post", "position": {"x": 1032, "y": 0}, "kind": "action", "settings": {"operation": "slack.postMessage", "args": {"to": {"mode": "path", "path": "settings.extras.digestChannel"}, "text": {"mode": "ai", "instruction": "Write the digest from the commit list: a one-line TL;DR, then at most 5 bullets grouped by area that name notable authors and link the commits. When count is 0, write exactly: No commits since the last digest. When truncated is true, say how many of totalAvailable commits are shown."}}}},
    {"id": "done", "name": "done", "position": {"x": 1376, "y": 0}, "kind": "end", "settings": {"outcome": "done"}}
  ],
  "edges": [
    {"id": "e1", "from": {"node": "weekdays8", "port": "out"}, "to": {"node": "commits"}},
    {"id": "e2", "from": {"node": "commits", "port": "out"}, "to": {"node": "digest"}},
    {"id": "e3", "from": {"node": "digest", "port": "out"}, "to": {"node": "post"}},
    {"id": "e4", "from": {"node": "post", "port": "out"}, "to": {"node": "done"}}
  ],
  "settings": {"extras": {"repository": "acme/web", "digestChannel": "C0123ABCD"}}
}
```

**New pull requests, not commits.** No catalog operation lists open pull
requests; the GitHub poller does. Replace `commits` with
`{"source": "inbox-poll", "poller": "github", "takeLimit": 10, "filter": {"scopes": ["acme/web"]}}`
(at most 10 per run; the poller also brings issues), and put a `filter` on
`item.kind` `equals` `pull_request` before `digest`, with both its ports wired
(`otherwise` to a `dismissed` End with a `reason`). Tell the user about the
10-per-run limit.

## Slack channels

Slack needs a channel id such as `C0123ABCD`, found in Slack under the
channel's details, at the bottom. Ask for it in the same message as the time
zone. Do not resolve a name with `provider-api-request`: it needs a workspace
connection and ends the turn in a connect request. `list-messaging-channels`
lists the app's messaging integrations, not Slack channels. A Source's channel
scope that is not an id is rejected at save. A post's `to` is not checked at
save and a dry run never posts, so a name there only fails on the first live
run.

## Connecting

Connections are per provider, from `connections` in a save or
`get-factory-workflow` result, or from `describe-workflow-node-catalog`.

- **`not connected`:** call `request-workflow-connection` with the provider.
  For Slack, GitHub, Sentry, HubSpot, Jira, Notion and BigQuery the chat shows
  a connect card and the turn waits for the user. Ask for one provider per
  turn. When the user says it is connected, call `get-factory-workflow` again
  to refresh `connections` and go on.
- **Gong, Pylon, Stripe, PostHog, Builder, email:** the call returns
  `connected: false` with `where` and `keys`. Tell the user exactly that, then
  check again when they say it is done.
- **`unknown`:** the check itself failed. Say so; do not call it connected or
  not connected.
- `set-factory-workflow-enabled` refuses with `connection_required` until every
  provider is connected. A step that fails `credential_missing` in a dry run
  means the same thing: connect it, then dry run again.

## Dry run loop

`run-factory-workflow` `mode: "dry"` reads real data and runs the AI, but every
write only reports what it would do. With `waitSeconds: 25` it returns:

- `status: "finished"`: `workflowRunId`, `runStatus`, `clean`, `counts`
  (`taken`, `done`, `itemFailures`, ...), `failedSteps` (node, code, message)
  and `needsConnection` (providers to connect).
- `status: "still_running"` with `runId` and `workflowRunId`: read it with
  `get-factory-workflow-run` (it takes either id), then again. Reads are not
  deduplicated.
- `status: "skipped"`, `reason: "already_running"`: another run of this
  workflow was going, so this one never started and nothing ran. Read
  `activeRunId` with `get-factory-workflow-run`, wait for it to end, then run
  again.
- `status: "not_started"`: the scheduler ended the run before the workflow
  began; `errorCode` and `message` say why.

Loop: run, read, fix, run again, until `clean` is true. A failed step's code
says what to fix: `expression_failed` is a path or value (read the step with
`get-factory-workflow-run`), `credential_missing` is a connection,
`graph_invalid` is the graph. `itemFailures` above zero with a clean-looking
step: `get-workflow-node-audit` for the node lists the item errors. Every fix
is a new save, so the next dry run is of the new version. Never use
`mode: "live"` to test: it sends real messages, only runs for an enabled
workflow, and stops for the user's approval like enabling does.

## When a run fails or behaves oddly

Call `get-workflow-diagnostics` (`factoryId`, optional `workflowId`, `runId`,
`sinceHours`, default 24, max 168) before guessing. It returns one JSON object
under 30 KB: build and deploy facts, whether recurring jobs are on, the
scheduler's heartbeat age, each provider's connection status, the workflow's
shape and job health, the last 10 runs with their failed steps, waiting items
and how many are overdue, writes that began and never confirmed, and the recent
tripwires with counts by code. `truncated` lists what was cut and `unavailable`
what could not be read.

- **A tripwire** is one typed row for something unexpected at a risky boundary
  (a provider answering in a new shape, a wait that woke late, a refused or
  slow tool call): ids, status codes, durations, counts and the shape of data,
  never raw values. It changes nothing; never branch on whether one exists.
- **Read in this order:** `unavailable`, then `scheduler` and
  `environment.recurringJobs` (nothing runs when those are off), `connections`,
  `runs[].failedSteps`, then `tripwires.counts` and `tripwires.recent`.
- **Tell the user** they can paste what "Copy diagnostics" gives them (the
  workflow's More actions menu, or Settings, Scheduler health): the same
  object, with no tokens, emails or URL query strings, so never ask for those.
- Codes are a closed list in `server/tripwire/types.ts`. Never put customer
  text, a message body or a credential into a tripwire's `details`.

## An item that needs a person

`list-workflow-items` with `needsYou: true` finds them. Once the cause is fixed,
`requeue-factory-item` sends one back to its workflow (it stops for the user's
approval: say which item and what it may send first); `dismiss-factory-item`
closes it and sends nothing. Both take `factoryId` and `itemId`, and a repeat
changes nothing.

## Merging a pull request

`github.mergePullRequest` merges only what the merge gate clears, and re-runs
the gate itself, so a graph that skips `factory.mergeGate` still cannot merge a
held pull request. The gate wants: a Builder account (`builderio-bot` or
`builder-io-integration[bot]`, no other name) opened it from a branch in the
repository, aimed at the default branch; every check on the head commit green;
no unresolved review thread and no review asking for changes; an approval of the
current head commit from a person who is an owner, member or collaborator, not
the author and not a bot or Builder account (a push after the approval needs a
new one); a small diff clear of the
never-automate paths. A held pull request goes to Needs you, and the Slack notice
carries every reason. `get-factory-merge-gate` returns them as `reasonCodes` and
`reasonText`; `approval_required` comes with `approvals` counts (`seen`,
`qualifying`, `byAuthor`, `fromBots`, `fromNonCollaborators`, `stale`). Explain a hold in
those words. Never approve or merge for the user: an approval is a person's, and
`requeue-factory-item` sends the item back once it is given.

## Other tools

`list-factory-workflows`, `get-factory-workflow` (`version`, or `nodeIds` for
a graph too large to read at once), `list-factory-workflow-versions`,
`restore-factory-workflow-version`, `delete-factory-workflow` (stops for the
user's approval: name the workflow and what goes with it first),
`list-factory-workflow-runs`, `get-factory-workflow-run`,
`get-workflow-node-audit`. To show something, `navigate` with
`/factory?factoryId=<id>&workflow=<id>` plus `node=`, `edge=`, `run=` or
`version=`.
