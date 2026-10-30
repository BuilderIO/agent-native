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
   - Before asking for an id, try `list-provider-options` (`provider` and
     `resource`: slack `channels`, github `repositories`, sentry
     `organizations`, then sentry `projects` with `parent`; `search` narrows
     it): it returns real channels, repos and projects, and fails with
     `credential_missing` while the provider is not connected.
3. **Read the catalog in two calls.** `describe-workflow-node-catalog` with
   `view: "index"` returns connection status, the graph shape, every node kind
   with its ports and a `settingsShape`, and one line per operation. Then one
   call with `operationIds: [...]` for the full fields and outputs of the
   operations you use: the index has only each one's id, label, kinds, effect
   and field names, and its outputs, limits and notes on each field come with
   that call. Read a kind's full schema (`kind: "source"`) only when
   its shape is not enough. The unfiltered call is too big for one tool result.
   The index lists the API request once, as `<provider>.apiRequest`: see
   "An endpoint no step covers".
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
{ nodes: [{ id, name, label?, kind, position: {x, y}, settings }],
  edges: [{ id, from: { node, port }, to: { node } }],
  settings: { timezone?, extras? } }
```

Send this object to `save-factory-workflow` as JSON text in `graph`: one string,
quotes escaped. A parse failure names the position: fix it and send again.

- `id` is a slug (letters, digits, `-`, `_`). `name` is an identifier (letters,
  digits, `_`, no spaces) and is how later nodes read this one: `nodes.<name>`.
  Reusing the id as the name is fine. Space `position.x` by 344.
- `label` is the friendly title people read on the canvas:
  free text up to 64 characters, such as `Post the digest to #support`. Set one
  on every node you add, in the user's words. `name` stays the identifier for
  paths and is never shown, so a label can change without breaking a `{{ }}`
  path. Omit it only to keep the default title.
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
| `nodes.<name>` | the output a node upstream attached (a Lookup's `into` renames it). A node that is not upstream fails with `bad_reference`, and so does a field its operation does not return: the error lists the real ones |
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
with the repo and channel in `settings.extras`, and a `label` on each node:

```json
{
  "nodes": [
    {"id": "weekdays8", "name": "weekdays8", "label": "Every weekday at 8", "position": {"x": 0, "y": 0}, "kind": "trigger", "settings": {"schedule": {"weekdays": {"at": "08:00"}}, "timezone": "America/New_York"}},
    {"id": "commits", "name": "commits", "label": "Commits since last digest", "position": {"x": 344, "y": 0}, "kind": "source", "settings": {"source": "window", "operation": "github.listCommits", "args": {"repo": {"mode": "path", "path": "settings.extras.repository"}}, "maxItems": 100}},
    {"id": "digest", "name": "digest", "label": "Build the digest", "position": {"x": 688, "y": 0}, "kind": "combine", "settings": {"mode": "list"}},
    {"id": "post", "name": "post", "label": "Post to the team channel", "position": {"x": 1032, "y": 0}, "kind": "action", "settings": {"operation": "slack.postMessage", "args": {"to": {"mode": "path", "path": "settings.extras.digestChannel"}, "text": {"mode": "ai", "instruction": "Write the digest from the commit list: a one-line TL;DR, then at most 5 bullets grouped by area that name notable authors and link the commits. When count is 0, write exactly: No commits since the last digest. When truncated is true, say how many of totalAvailable commits are shown."}}}},
    {"id": "done", "name": "done", "label": "Done", "position": {"x": 1376, "y": 0}, "kind": "end", "settings": {"outcome": "done"}}
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

## An endpoint no step covers

When no operation reads what the user wants, add a Lookup with
`<provider>.apiRequest` rather than saying it cannot be done. It sends a
read-only GET to any path of a connected provider: slack, github, hubspot,
gong, pylon, stripe, posthog, bigquery, jira, notion or sentry. Read it with
`operationIds` first: its description and field notes are the reference.

- **Find the path before you write it.** `provider-api-catalog` with the
  provider gives its base URL, example paths and docs links; `provider-api-docs`
  with a `url` reads the endpoint's page. `path` sits below that base URL
  (Slack `conversations.history`, Stripe `customers`), with no host. PostHog,
  BigQuery and Sentry keep `{projectId}` or `{orgSlug}` in a path for the
  connection to fill. Parameters go in `query`, never after a `?`.
- **The answer is the provider's own JSON** at `nodes.<name>`. Its fields are
  not checked at save, so read the real shape after a dry run, from the item's
  summary in `get-workflow-node-audit`, before binding a later step to a path in
  it. `includeStatus: true` makes it `{status, headers, body}`. With `pagination`
  (the next cursor must be a plain field in the body; at most 5 pages) it is
  `{pagesRead, moreAvailable, nextCursor, items}`: say when `moreAvailable`.
- **A cut answer says so first.** Past about 33,000 characters it leads with
  `truncated: true` and `cuts`: each list shortened (`kept` of `of`), text
  clipped, or key left out, by path. A list becomes `{truncated, count,
  totalAvailable, cuts, value}`, so `nodes.x[0]` stops reading and
  `nodes.x.value[0]` starts: test `nodes.x.truncated` before relying on a count,
  and tell the user how many came back of how many. The step carries
  `outputsTruncated`. Fewer or narrower results (`per_page`, a filter) are the
  fix, not a bigger read.
- **For a list or big objects, set `fieldsToKeep`** (Fields to keep): dotted
  paths such as `["number", "title", "user.login"]`. The step passes on only
  those, cut before any size limit, so three 25 KB pull requests stay whole.
  A path inside a list applies to every entry, and `user` keeps all of `user`.
  Paths that matched nothing come back in `nodes.<name>.fieldsMissing` (a list
  then reads `nodes.<name>.value[0]`): fix the typo and tell the user. With
  `pagination` it trims each entry; with `includeStatus` only the `body`. An
  answer that says the provider did not do it (Slack `ok: false`, BigQuery
  `jobComplete: false`, an `errors` list) always keeps those keys, so read
  `nodes.<name>.ok` and `.error` before trusting an empty result.
- **One step hands on about 64 KB in all**, counting every item it emits and
  every earlier answer still attached to each (`nodes.<step>`). Three big reads
  in a row, or one read over several items, fail as `output_over_cap` naming the
  step; the cap is not raised. Set `fieldsToKeep`, narrow the request, or split
  the work.
- **Never from a model.** `path` may be typed, a setting, an item field or an
  earlier lookup, not AI-written (`model_written_target`), and the step is never
  an AI step's tool (`unknown_tool`). Headers never carry credentials: the
  connection signs the request.
- **Limits to tell the user:** GET only, JSON only, no body, no POST searches,
  no page-number or `Link` paging. A refused request fails the item as
  `lookup_failed` with the reason in brackets, such as `unsafe_path_value`,
  `full_url_refused`, `header_denied`, `invalid_fields_to_keep`; a 404 is not
  retried.
- **What the app shows.** Test step on an API request shows the whole response on
  screen for the person and keeps none of it; a run, and so anything you read back
  with `get-workflow-node-audit`, keeps only a short summary of the answer.
- **Test it on its own.** A Lookup that reads no `item.*` or `nodes.*` runs
  once in a `mode: "test"` run with no `sampleItemIds`. Any other step with none
  pinned is refused as `test_needs_items`, nothing started: pin items from a dry
  run, or run the whole workflow first.

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
- **`unknown`:** the check itself failed, or a saved key (a Sentry organization
  slug, a Jira token) exists but cannot be decrypted here; `detail` says which.
  Say so; do not call it connected or not connected. An unreadable key is
  fixed by saving it again, not by adding another.
- **Sentry also needs `SENTRY_ORG_SLUG`:** a token alone reads `not connected`,
  with the slug named in `detail`.
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

## Builder: start, then check

Builder ignores the branch name a start asks for and keeps its own. `builder.start`
returns it as `externalRef` (also `branchName`), and a start whose receipt was
reused still supplies it.

- **Bind every later Builder step to the start's receipt.** `builder.check` and
  `builder.followUp` take `branchName` as
  `{ "mode": "path", "path": "nodes.<start step>.externalRef" }`. The name you
  asked for is not the one Builder keeps, so a check on it reads `not_found`.
- **Route on `state`, `hasPullRequest`, `prNumber` and `prUrl`.** There is no
  `status` and no `pullRequest.number`; a save that reads a name `builder.check`
  does not return is refused with the real names listed. Test `hasPullRequest`,
  never `prNumber > 0`: `prNumber` is null until a pull request exists.
- **`state` is `working`, `stuck`, `completed`, `failed` or `not_found`.**
  `completed` means Builder is idle and a pull request exists, whether open,
  closed or draft; read `prStatus` before treating it as done. `failed` is a real failure (the branch
  was archived or deleted without a merge). `not_found` is not a failure: Builder
  has no active branch under that name, which can mean the task finished and was
  archived, the name is not the one Builder returned, or the task was never
  created. Wait and check again, or hand it to a person; do not report it as
  Builder failing.
- **Put `reason` in any message that says what Builder is**, such as
  `Builder is {{ nodes.check.state }} ({{ nodes.check.reason }})`, so a person
  can tell `branch_not_found` from `branch_archived`.
- **A start is deduplicated only by the branch name it asked for.** Builder
  renames branches, so a start whose receipt was lost can start a second task.
  Ask for a name unique to the task. `builder.followUp` succeeding means Builder
  queued the message, not that it acted on it.

## Merging a pull request

`github.mergePullRequest` merges only what the merge gate clears, and re-runs
the gate itself, so a graph that skips `factory.mergeGate` still cannot merge a
held pull request. The gate wants: a Builder account (`builderio-bot` or
`builder-io-integration[bot]`, no other name) opened it from a branch in the
repository, aimed at the default branch; every check on the head commit green;
no unresolved review thread and no review asking for changes; an approval of the
current head commit from a person who is an owner, member or collaborator, not
the author and not a bot or Builder account (a push after the approval needs a
new one); a small diff clear of the never-automate paths; a test change beside
any code change (docs, changesets, lockfiles, package manifests and config need
none); and a `### Verified` section in the description with text, a screenshot
or a recording. A held pull request goes to Needs you, and the Slack notice
carries every reason. `get-factory-merge-gate` returns them as `reasonCodes` and
`reasonText`; `approval_required` comes with `approvals` counts (`seen`,
`qualifying`, `byAuthor`, `fromBots`, `fromNonCollaborators`, `stale`), and
`no_regression_test` and `no_verification_evidence` are the two proof rules.
`github.readPullRequest` returns `verification` (`present`, `hasMedia` and a
short `excerpt` of the Verified section, never the description itself) for a
graph that wants to route on it. The shipped builder-to-merge story asks an AI
step, `judge`, after the gate and before the merge whether that excerpt
plausibly shows the fix: `verified` goes on to the merge, `unsure` (or a judge
that fails) holds the pull request for a person, and it never approves. Explain
a hold in those words. Never approve or merge for the user: an approval is a person's, and
`requeue-factory-item` sends the item back once it is given.

## Jira and Sentry steps

The issue key (`PROJ-123`) and the Sentry issue id (digits) come from an item
field or a setting, never an AI step. A bad one fails the item before the
provider is called. Each write is sent once; `_outcome_unknown` means check.

- `jira.getIssue` (Lookup): status, `statusCategory`, resolution, assignee,
  labels and `transitionNames`, capped, with `truncated` when cut.
- `jira.listTransitions` (Lookup): what the issue can take now, each with `id`,
  `name` and `toStatus`.
- `jira.transitionIssue` (Action): moves it by transition name or id, read first
  against Jira's own list. An unknown or ambiguous name is refused, never
  guessed. Naming the status it is already in succeeds with `alreadyInState`.
- `sentry.resolveIssue` (Action): `resolution` is `resolved` or
  `resolvedInNextRelease`. Sentry's answer must confirm it.
- `sentry.assignIssue` (Action): `assigneeKind` `user` (`assignee` is an email),
  `team` (a lowercase slug, read first; unknown is refused) or `nobody`.

## Labels and reactions

Writes run only on an `action` step, never as a Lookup, a Source or an AI
tool. A dry run and a test of the step say what they would send and send nothing.
Factory has no step that comments on a GitHub issue: findings go to Slack.

- `github.addLabels`: `repo`, `number` and `labels`, a list of 1 to 5 names of
  up to 50 characters, no comma. A label already there stays, so a repeat
  changes nothing. Gives `labels`, all the item has now.
- `github.removeLabel`: `repo`, `number` and `label`. An item without it
  succeeds with `alreadyAbsent: true`.
- `slack.addReaction`: `channel` (an id), `ts` (the message's time; for a report
  that starts a thread, `item.thread.threadTs`) and `name`, an emoji without
  colons, such as `eyes`. A repeat succeeds with `alreadyReacted: true`.

- **Only the factory's own repository.** A label step refuses any other
  `repo`, and a factory with no repository set, with `repository_not_allowed`,
  as the merge step does; set the repository in the factory before using one.
- **A model writes none of these fields.** `repo`, `number`, `labels`, `label`,
  `channel` and `ts` say where the write lands (a label can start automation in
  the repository): type them, or read a setting, an item field or a lookup,
  never an AI step's answer (`model_written_target`).
- **A bad value is refused on the first live run, not in a dry run.** A dry run
  never calls the step, so check the limits above yourself: a refusal is typed
  (`github_label_invalid`, `github_repository_invalid`, `repository_not_allowed`,
  `slack_channel_invalid`, `slack_reaction_invalid`) and sends nothing.
- **Read a failure by its code.** `github_access_denied` is a connection with no
  write access (Slack `slack_access_denied`, `missing_scope`: the app needs
  `reactions:write`); connect again with the right access. `github_not_found`
  and `slack_not_found` wrote nothing. A code ending `_outcome_unknown` may have
  written: the item goes to Needs you and nothing sends it again, so check the
  issue or message first.
- **The loop's own reaction is not a person's.** A Source's `claimReaction`, a
  reply Wait's `ackReaction` and `slack.readThread` leave out the app's own
  bot, so reacting `eyes` to a report never marks it claimed. `slack.readThread`
  lists the bot's reactions apart, under `ownReactions`, and `reactions` holds
  only everyone else's.

## Other tools

`list-factory-workflows`, `get-factory-workflow` (`version`, or `nodeIds` for
a graph too large to read at once), `list-factory-workflow-versions`,
`restore-factory-workflow-version`, `rename-factory-workflow` (the workflow's
own name in the list and toolbar; a save never renames, and the version, graph
and on/off state stay), `delete-factory-workflow` (stops for the
user's approval: name the workflow and what goes with it first),
`list-factory-workflow-runs`, `get-factory-workflow-run`,
`get-workflow-node-audit`, `get-workflow-node-data` (the item fields a node
took in and put out in a run; not lookup or action responses or AI answers).
To show something, `navigate` with
`/factory?factoryId=<id>&workflow=<id>` plus `node=`, `edge=`, `run=` or
`version=`.

- A person's unsaved edits in the editor autosave as a private draft, and `get-factory-workflow` returns `hasDraft` (true when this person has one). When it is true, say so before saving a new version, because the editor will then offer Keep my changes or Load latest; the agent never reads or writes drafts.
