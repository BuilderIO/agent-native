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

## Start cursor

Use the product feedback Slack channel configured for the workspace. In this
repository that is currently `#product-agent-native-feedback` (`C0ATH3CCZT4`);
if the invocation names another channel, use that channel instead.

Scan the channel newest to oldest and choose the most recent parent message
with neither:

1. an `👀` reaction, nor
2. a meaningful reply from Steve, `agent-native`, or another person clearly
   investigating or owning the report.

That message is the start cursor. Classify it, record it if it is not
actionable, then continue toward older messages, processing each actionable
message that is still unhandled. Do not restart at the beginning of the
channel on every run, and do not treat a generic acknowledgement, bot reply,
or vague status update as a terminal ownership marker. Read the full parent,
every reply and reaction, and all linked issues, PRs, screenshots, runs, and
commits before deciding.

For GitHub issues and Sentry, use their native state and links as corroborating
cursor signals: prioritize recent open or unresolved items with no clear
maintainer disposition, then deduplicate them against the Slack set. If a
source cannot be read, record that source as unavailable; never report
“nothing matched” for an unavailable source.

Keep the cursor at the first unhandled parent, but fold older messages that are
clearly the same symptom into that cluster instead of reopening a new thread for
each duplicate. Continue to older messages only after the cluster is recorded
and every grouped report has an auditable disposition.

## Answered clarifications come first

A clarification question is a pending state, not a disposition. Before scanning
for new messages, re-read every thread this workflow asked a question in that
has not since been fixed or otherwise dispositioned, oldest question first.

- **The reporter replied** - that thread is the run's first work item. It
  re-enters triage as a concrete bug carrying the new evidence, ahead of
  anything newer in the channel: someone answered and is waiting on a fix.
- **No reply yet** - leave it pending and record it in the recap with the date
  the question was asked, so an unanswered question stays visible instead of
  ageing out of the cursor.
- **The reply does not supply what was asked** - ask the one remaining question
  only if it is still the blocker; otherwise fix from what is now available.

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
name the exact gap in the final recap. Do not infer a Sentry “no results” state
from an unavailable API.

## Triage and fix-altitude gate

Build one checklist per item with its source link, symptom, expected behavior,
evidence, likely owner, and disposition. Use this order:

1. **Concrete repo-owned bug** - reproduce or establish it from source,
   tests, logs, a stack trace, or a linked run. Add `👀` to the Slack thread
   immediately after classification, before investigation or delegation. Fix
   it and keep working until the smallest meaningful verification is green.
2. **Missing reporter evidence** - after reading the full thread and linked
   evidence, ask one specific question naming the exact reproduction, input, or
   surface needed to choose and verify a safe fix. Add `👀` before asking. If
   only internal test, deployment, or tooling verification is unavailable,
   keep that blocker internal and do not ask the reporter for it.
3. **Subjective UX or product suggestion** - do not turn a preference into a
   code or prompt rule. Act only when the report identifies a concrete broken
   behavior, an existing product invariant, or repeated independent evidence;
   otherwise record it as deferred or informational.
4. **Policy, bot-forward, status-only, duplicate, external, or non-repo-owned
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

1. Record the start cursor and ownership baseline with `git status --short`,
   the current branch, worktrees, and leases. Treat unfamiliar dirty paths as
   peer-owned. Never reset, clean, stash, switch, rebase, or overwrite them.
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
6. This skill is authorized to react to actionable Slack threads and post one
   concise in-thread update for each actionable item it handles. Post only
   after the fix or clarification is ready. A fix reply says only that it is
   fixed and when it should be live; a clarification reply asks one concrete
   question about missing reporter or product input. Keep implementation and
   verification evidence in the internal recap, not the reporter-facing reply.
   If the fix is complete but internal verification is unavailable, do not post
   yet; leave it pending for the next verification pass.
   Do not post vague progress, technical internals, or a diagnosis that leaves
   a safely fixable bug undone. Re-read every thread after posting. A fix reply
   authored by this skill's own identity is a handled marker on the next run;
   a clarification reply is not. A clarification reply marks the thread
   pending an answer, to be re-read by the answered-clarifications pass.
7. Do not close, label, assign, or comment on GitHub issues or Sentry unless
   the invocation explicitly authorizes those mutations. Link the issue or
   event in the recap instead.

## Worktrees and publishing

A worktree is a valid PR source. When this skill is run in an authorized
worktree, use that worktree's current branch and cwd for its tests, commit,
push, and PR creation or update. Do not copy changes into the shared checkout.
The same ownership rules apply: stage explicit paths only, never `git add -A`,
never use a whole-worktree ship helper when peer paths are present, and update
an existing PR rather than opening a second one.

This skill may prepare a ready PR when the invocation grants publish
authority. It must not merge or auto-approve its own fix unless the user also
explicitly invokes the relevant shipping or PR-review workflow. If publishing
authority is absent, leave the verified change in the current worktree and
say so in the recap rather than claiming it shipped.

## End-of-run recap

Every run ends with a compact recap for every item inspected, including items
skipped, duplicated, already owned, blocked by missing evidence, or blocked by
an unavailable connector. Include direct links to the Slack message or thread,
GitHub issue, Sentry event, PR, commit, and verification result when present.

Use this shape:

```md
## Feedback sweep
Start cursor: [Slack message](...)

| Source / item | Disposition | Action | Why and evidence |
| --- | --- | --- | --- |
| [Slack thread](...) | Fixed / Awaiting reply / Clarification needed / Skipped / In progress | ... | ... |
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
