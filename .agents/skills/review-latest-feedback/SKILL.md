---
name: review-latest-feedback
description: >-
  Review the newest unhandled Slack, GitHub issue, and Sentry feedback, fix
  clear verified repo bugs at the owning boundary, and recap every disposition.
  Use for scheduled or manual feedback sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

Run a bounded, evidence-first sweep across the Agent-Native feedback sources.
The goal is to resolve clear repo-owned bugs at the right seam, not to encode
one report as a new global instruction. This skill can run from a cron or a
worktree, but every run must leave an auditable disposition for every item it
looked at. When several reports clearly describe the same underlying symptom,
treat them as one similar-feedback cluster and leave one Builder thread for the
cluster, with the representative report as its cursor anchor.

This is a reply-producing workflow, not a reaction-only workflow. Apply the
reply rules in `address-feedback-with-replies` to every actionable Slack item.
Reaction state is part of triage. Before a Slack parent enters this workflow,
inspect the parent's reactions. If any `👀` reaction is already present, do not
add another one or treat the parent as a new candidate for automatic
investigation; record it as already marked or owned. A reporter reply to a
clarification this workflow previously asked is a continuation of that
existing ledger item, not a new candidate, so re-read and resume it without
adding another reaction, subject to the ownership routes below. The moment
this skill adds `👀` to a Slack parent,
that parent enters a mandatory reply ledger. Before the run ends, re-read every
ledger item and confirm that Steve has posted either a concise **Fixed** reply
or a concise **Clarification needed** question. A bot acknowledgement, another
person's reply, or the `👀` reaction alone never satisfies the ledger. Do not
finish the sweep or report success while an actionable parent that this run
marked has only `👀` or an unrelated reply.

## Start cursor

Use the product feedback Slack channel configured for the workspace. In this
repository that is currently `#product-agent-native-feedback` (`C0ATH3CCZT4`);
if the invocation names another channel, use that channel instead.

Scan the channel newest to oldest and choose the most recent parent message
without a final disposition reply from Steve, `agent-native`, or another person
clearly investigating or owning the report, and without an existing `👀`
reaction. Check the parent reaction list before selecting it. An `👀` reaction
from anyone is an ownership/investigation marker for this automation: do not
add a duplicate reaction, investigate the item as new work, or post a new
reply. Record it as skipped because it is already marked or owned. The only
exception is a reporter reply to a clarification this workflow previously
asked; re-enter that existing ledger item, but never add another `👀`. Do not
treat a generic acknowledgement, bot reply, or vague status update as a final
disposition when no `👀` marker is present. Apply the ownership routes below
before re-entering any existing ledger item.

That message is the start cursor. Classify it, record it if it is not
actionable, then continue toward older messages, processing each actionable
message that is still unhandled. Read the full parent, every reply and
reaction, and all linked issues, PRs, screenshots, runs, and commits before
deciding.

For GitHub issues and Sentry, use their native state and links as corroborating
cursor signals: prioritize recent open or unresolved items with no clear
maintainer disposition, then deduplicate them against the Slack set. If a
source cannot be read, record that source as unavailable; never report
“nothing matched” for an unavailable source.

Keep the cursor at the first unhandled parent, but fold older messages that are
clearly the same symptom into that cluster instead of reopening a new thread for
each duplicate. Continue to older messages only after the cluster is recorded
and every grouped report has an auditable disposition.

## Ownership routing

Classify the app surface and ownership before adding a reaction or doing any
investigation:

- A UX or interaction bug in the Design app belongs to Sid. Do not
  automatically add `👀`, investigate, edit code, ask for clarification, post a
  reply, or dispatch work for it. Record the source link as **Already owned -
  Sid / Design**.
- Any feedback about the Content app belongs to Alice. Do not automatically
  add `👀`, investigate, edit code, ask for clarification, post a reply, or
  dispatch work for it. Record the source link as **Already owned - Alice /
  Content**.

These ownership routes apply even when the report is concrete or appears to
need more evidence. Only an invocation that explicitly assigns the item to
this workflow can override the route. A pre-existing `👀` on an owner-routed
item is still only a marker to preserve in the recap; never add another one or
post a reply merely because it is present.

## Full-thread evidence gate

Before asking a reporter for anything, re-read the complete parent thread to
the end, including every reply, reaction, attachment, linked artifact, and
newer follow-up. Paginate until there are no more replies. Build a small
evidence ledger for the thread with the values already known - surface or app,
URL, account or session, repro steps, exact error, screenshot or file, run or
request ID, and the answer to each earlier question - and a separate list of
what is still missing. Keep a separate list of linked artifacts that are
present but inaccessible because of permissions, expiry, connector gaps, or
another read failure. Treat an attachment or an earlier reply as evidence to
inspect, not as a reason to ask for the same thing again; inaccessible evidence
is not the same as absent evidence.

The clarification question must be derived from that missing-evidence list.
Never ask for a URL, screenshot, error, run ID, or repro detail that is already
in the parent or a reply. If the reporter supplies it later, re-read the whole
thread before doing anything else, remove that field from the missing list,
and try the fix from the new evidence before asking another question. If the
answer only partially fills the gap, ask only for the one remaining field. If a
needed linked artifact is inaccessible, ask for access or a fresh/replacement
link rather than asking for the artifact's contents again. If the available
evidence is enough without it, continue and record the limitation instead of
creating a reporter blocker.

## Answered clarifications come first

A clarification question is a pending state, not a disposition. Before scanning
for new messages, re-read every thread this workflow asked a question in that
has not since been fixed or otherwise dispositioned, oldest question first.

- **The reporter replied** - re-read the complete thread and rebuild its
  evidence ledger first. That thread is the run's first work item. It re-enters
  triage as a concrete bug carrying the new evidence, ahead of anything newer
  in the channel: someone answered and is waiting on a fix.
- **No reply yet** - leave it pending and record it in the recap with the date
  the question was asked, so an unanswered question stays visible instead of
  ageing out of the cursor.
- **The reply does not supply what was asked** - ask the one remaining question
  only if it is still the blocker; otherwise fix from what is now available.

When a reporter answers a question this workflow previously asked, do not just
record the answer or leave the old clarification as the disposition. Read the
entire thread again, use the new evidence to attempt the fix in this run, and
post a new **Fixed** reply when the fix is verified. Ask another question only
for the one remaining missing detail. An answered clarification is never a
reason to skip the thread or continue scanning newer messages.

Our own question is what makes a thread look owned to the cursor rule above,
which is why this pass runs first. Without it every thread we asked about
becomes permanently invisible on later runs and the reporter's answer is never
read.

## Required reading and tools

Before changing code, read `address-feedback`,
`address-feedback-with-replies`, `concurrent-agents`, and
`verifying-changes`. Read `ship` when a verified fix is ready to publish.

Use the configured Slack, GitHub, and Sentry connectors when available:

 - Slack: channel history, reactions, full thread replies, permalinks, and
   linked evidence.
 - GitHub: the newest relevant open issues in `BuilderIO/agent-native`, all
   comments and linked PRs, labels, current state, and duplicate searches.
 - Sentry: newest unresolved errors for the repository's projects, stack
   traces, route or component, frequency, affected release, and event links.

If a connector or permission is missing, continue with the other sources and
name the exact gap in the final recap. Treat that as unavailable evidence, not
as “nothing matched.” If the unavailable source is required to identify or
verify a safe fix, ask for access or a fresh/replacement artifact; do not ask
again for details that the inaccessible source was already known to contain.
Do not infer a Sentry “no results” state from an unavailable API.

## Triage and fix-altitude gate

Build one checklist per item with its source link, symptom, expected behavior,
evidence, likely owner, and disposition. Use this order:

1. **Check ownership and reaction state before any Slack write** - classify
   the app surface first, then read the parent's reaction list. For a Design
   UX/interaction report or any Content report, use the ownership route above
   and do not react. If any `👀` is already present, skip new automatic work
   and do not react. Only a concrete repo-owned bug or missing-reporter-
   evidence case with no existing `👀` may receive one `👀` reaction, and that
   reaction must be the first external action for the Slack item - before
   reading linked evidence, delegating, editing code, or asking a
   clarification. Never attempt a duplicate reaction when reaction state is
   unavailable; record the item as unavailable/unverified and refresh the
   thread before writing. GitHub and Sentry items have no Slack parent, so
   apply the same evidence-first triage without a reaction. Do not react to
   status-only, subjective, duplicate, external, or non-repo-owned items.
2. **Concrete repo-owned bug** - after the `👀` marker, reproduce or establish
   it from source, tests, logs, a stack trace, or a linked run. Fix it and keep
   working until the smallest meaningful verification is green.
3. **Missing reporter evidence** - after the `👀` marker and full-thread
   review, ask one specific question naming the exact reproduction, input, or
   surface needed to choose and verify a safe fix. If a needed linked artifact
   is inaccessible, ask for access or a fresh/replacement link instead of
   treating its contents as absent. If only internal test, deployment, or
   tooling verification is unavailable, keep that blocker internal and do not
   ask the reporter for it.
4. **Subjective UX or product suggestion** - do not turn a preference into a
   code or prompt rule. Act only when the report identifies a concrete broken
   behavior, an existing product invariant, or repeated independent evidence;
   otherwise record it as deferred or informational.
5. **Policy, bot-forward, status-only, duplicate, external, or non-repo-owned
   item** - do not react, reply, or edit code unless the user explicitly
   assigns a concrete repo action.

For a report that is actionable, choose the narrowest seam supported by the
evidence:

 - One isolated symptom -> fix the owning local seam and add a regression check.
 - Repeated or cross-surface symptoms -> inspect the shared primitive,
   contract, or boundary before touching a leaf.
 - Missing capability or wrong tool -> fix discovery, registry, or action
   contract wiring rather than adding a workaround in one chat.
 - Source-versus-live mismatch -> diagnose build, deployment, release, or
   environment state before changing source.

Never hard-code a rule for the wording or situation in one chat report. A
single data point can justify a local regression test or a contained product
fix, but it cannot by itself justify a global agent instruction, prompt rule,
or behavior exception. Broaden guidance only when repeated evidence names an
invariant and the shared owner is clear. For repeated feedback that is the same
underlying issue, handle it as one cluster with one Builder thread, not one
thread per report; use separate threads only when the evidence shows different
failure modes, surfaces, or owners.

## Investigation workflow

1. Record the start cursor with `git status --short`, the current branch, and
   worktrees. Read existing local changes before editing. Never reset, clean,
   stash, switch, rebase, or overwrite them without explicit authorization.
2. Read Slack threads, GitHub issues, and Sentry evidence in parallel when
   their write sets are independent. Search recent Slack, Git history, merged
   PRs, GitHub issues, and Sentry fingerprints for repeats or an existing fix
   before opening a new path.
3. For each concrete bug or similar-feedback cluster, establish the failing
   behavior first. Read every grouped Slack thread and linked evidence before
   dispatching. Prefer a focused regression test or a deterministic
   reproduction over a prose-only diagnosis. Keep source, test, built,
   deployed, and observed-live claims separate.
4. Fix the owning boundary at the altitude selected above. Do not add a
   feedback-specific branch when a shared contract, action, registry, or
   deployment boundary explains the reports.
5. Verify each fix with the narrowest relevant test, typecheck, guard,
   action read-back, browser path, or live check. For UI changes, exercise the
   running surface. For Sentry reports, confirm the affected release and
   distinguish a source fix from deployed and observed-live recovery.
6. This skill is authorized to react to actionable Slack threads and must post
   one concise in-thread update for every actionable parent it marked `👀`, not
   only for items whose code it changed. Post only after the fix or
   clarification is ready. A **Fixed** reply says that the fix is complete and
   when it should be live. A **Clarification needed** reply asks one concrete
   question about missing reporter or product input. Thank the reporter by name
   when available and ask for the smallest useful evidence - such as a deck URL
   and/or request ID - as help to investigate rather than as a terse demand.
   Keep implementation and verification evidence in the internal recap, not the
   reporter-facing reply. `👀` is the first external action, never the final
   disposition. Do not end the run with an eye-only item, a bot-forward, a
   generic acknowledgement, or a vague progress update. If internal
   verification is unavailable, keep investigating or run the missing check; do
   not turn an internal blocker into a reporter question or claim **Fixed**.
   If a later classification discovers that an item this run marked is a
   duplicate, external, or informational, still clear this run's ledger with a
   concise honest disposition rather than leaving the eye unexplained. A
   pre-existing `👀` belongs to the person or workflow that added it and does
   not create a reply obligation for this run.
   Before posting **Clarification needed**, run the full-thread evidence gate
   again against the latest thread body. Confirm that the requested field is
   absent from the parent, every reply, and every accessible linked artifact;
   if it is present, use it and keep investigating instead of asking again. If
   a needed linked artifact is recorded as inaccessible, the access or
   replacement request is valid - do not describe its contents as absent. Do
   not post vague progress, technical internals, or a diagnosis that leaves a
   safely fixable bug undone. Re-read every thread after posting and confirm the
   reply landed under the intended parent. A fix reply authored by this skill's
   own identity is a handled marker on the next run; a clarification reply
   satisfies this run's reply obligation but leaves the thread pending an
   answer. The answered-clarifications pass must re-enter the thread and try the
   fix when the reporter answers.
7. Do not close, label, assign, or comment on GitHub issues or Sentry unless
   the invocation explicitly authorizes those mutations. Link the issue or
   event in the recap instead.

## Worktrees and publishing

A worktree is a valid PR source. When this skill is run in an authorized
worktree, use that worktree's current branch and cwd for its tests, commit,
push, and PR creation or update. Do not copy changes into the shared checkout.
When publishing is authorized, use `corepack pnpm ship:push` for the complete
nonignored snapshot and update an existing PR rather than opening a second one.

This skill may prepare a ready PR when the invocation grants publish
authority. It must not merge or auto-approve its own fix unless the user also
explicitly invokes the relevant shipping or PR-review workflow. If publishing
authority is absent, leave the verified change in the current worktree and
say so in the recap rather than claiming it shipped.

## Ship handoff

When a verified fix is ready for `/ship`, make the handoff explicit instead of
leaving the shipping workflow to reconstruct the sweep. Include the exact
start cursor, grouped source reports, evidence links, owning seam, focused
verification, and one disposition for every item in the PR body or ship recap.
Keep source-tested, built, published or deployed, and observed-live claims
separate. If the branch changes or new Slack, GitHub, or Sentry evidence
arrives, tell `/ship` to refresh the sweep before merging. An unavailable
connector remains unavailable in that handoff and must never be summarized as
“nothing matched.”

## End-of-run recap

Every run ends with a compact recap for every item inspected, including items
skipped, duplicated, already owned, blocked by missing evidence, or blocked by
an unavailable connector. Include direct links to the Slack message or thread,
GitHub issue, Sentry event, PR, commit, and verification result when present.
For Slack, include the reply-ledger result for every parent this run marked
`👀`: Steve reply timestamp and disposition, or the exact reason the item was
not marked. Also record every pre-existing `👀` skip and every owner route to
Sid or Alice; those items do not require a new reaction or reply from this run.
Never call a sweep complete while an actionable Slack parent in this run's
ledger has no Steve reply.

Use this shape:

```md
## Feedback sweep
Start cursor: [Slack message](...)

| Source / item | Disposition | Action | Why and evidence |
| --- | --- | --- | --- |
| [Slack thread](...) | Fixed / Awaiting reply / Clarification needed / Already owned / Skipped / In progress | ... | ... |
| [GitHub issue](...) | ... | ... | ... |
| [Sentry event](...) | ... | ... | ... |

Awaiting reply: [thread](...) - asked YYYY-MM-DD, still unanswered
Unavailable or unverified: ...
```

Keep each row succinct, but do not omit an item merely because no code
changed. “Nothing matched” is valid only after each source was successfully
queried and the cursor and filters are stated.

When multiple source items were grouped into one similar-feedback cluster, name
the representative item and list the grouped source links in that row. Record
one Builder dispatch for the cluster, while preserving the disposition of every
individual report.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `concurrent-agents`,
`verifying-changes`, `ship`
