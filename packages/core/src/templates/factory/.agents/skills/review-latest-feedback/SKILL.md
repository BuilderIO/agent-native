---
name: review-latest-feedback
description: >-
  Review Slack, GitHub, CI, Sentry, Analytics, diagnostics, linked trackers,
  and app/template, desktop, and package deploy/release lanes. Answer reporters
  first; fix verified defects, verify delivery, build upvoted features, and
  recap. Use for scheduled or manual sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

Feedback reactions are permanent history: never remove or clean up a reaction.
An owned `👀` does not by itself mean work is still open; the current disposition
and status reply say what remains. Put new workflow `👀`, `✅`, and `🎫`
reactions on the report root, never on a reply. Classify every in-scope root as
feedback or administrative; administrative means the post is not user
feedback, not merely that it came from a bot or duplicates another report.
Claim each eligible open report that passes the ownership gate with a root
`👀`, then post one same-actor status in its root thread after the latest human
reply. For roots already owned by this actor, reuse the current status unless
new human input, proof, disposition, or next action changes it. Do not reply on
another actor's owned root, administrative post, or duplicate thread; record
the ownership or classification reason and link duplicates to their canonical
report. Read each full thread and every changed status back.

Ensure one root `✅` is present when any named scope passes direct post-change
proof; that single reaction covers every verified scope in `fixedScopes`. Ensure
one root `🎫` is present when any named action is accepted; it covers the
accepted entries in `handoffs` and remains after an accepted action is completed.
Record completion evidence and set that handoff's status to `completed`; it is
historical accepted work, not an open follow-up. Remove it from active handoffs
only if the owner later withdraws, preserving the ticket as a historical mark.
Do not add duplicate copies of a mark for multiple scopes. An existing `👀` may
coexist with either mark and remains after work closes. A reply-level mark is
inventory history, never a root checkoff. A reaction is not a substitute for a
status reply. Read back the final threads/reactions and pass the inventory
checker before recap.

Do not target a number or ratio of reactions. Reconcile every owned report root
and every one of its scopes. In the final pass, reopen **every** report root
with this actor's marks, including every eye-only root even when eye-only rows
are a minority: recheck each scope; update/read back the current status when
its evidence or next action changed; ensure the root has one `✅` whenever at
least one scope has direct proof; and ensure one `🎫` only when a named human
accepted a separate action, including one recorded as completed. Preserve all
existing marks. When every scope closes, record the closed disposition and read back the final status and
reactions; an existing `👀` is historical, not evidence that work remains open.

`✅` covers each scope that passes direct post-change proof, including while
its PR is open. Use a focused regression that asserts the reported behavior or
replay the exact flow on the changed running app/preview; source inspection,
merge, an unrelated suite, or deploy alone do not qualify. Before merge, call
the scope **Verified locally** and say merge is pending. `✅` records the
verified scope; `👀` is retained history and does not say whether work remains
open. After merge, call the scope **Fixed** when its behavior has direct proof.
When a report has both verified and unfinished scopes, keep the verified
scope(s) under **Verified locally** before merge, or use **Partially fixed**
after merge; include a `✅` for the verified scope(s) and retain `👀` for the
unfinished scope(s). Do not call the whole report **Fixed** while any reported
scope or accepted handoff remains open.
Reserve **Shipped**/**Live verified** for their
release/runtime evidence. `🎫` records an accepted human action, not a ticket,
mention, or assignment.

Phase 0 gates and claims eligible work before investigation. Then answer newer
replies, fix what the evidence proves at its owning boundary, and recap. Follow
the shared mark lifecycle in
[`slack-reaction-replies.md`](references/slack-reaction-replies.md).

Before recap, repeat the exact original channel-wide `slack_search_public`
query for every scoped channel, including its inclusive `scanQuery.after` and
all other recorded arguments. Follow every `next_cursor` to Slack exhaustion;
do not stop when a page crosses the cutoff, because later pages can contain
replies to older roots. Apply `ts >= cutoffTs` when counting the captured
messages, not as a reason to stop pagination. `oldestQuery` records only a
separate exclusive `oldest` bound when one was actually passed; it does not
replace `scanQuery.after`. Replace that channel's old page manifests and rows
with the new responses. A newest-first delta from a saved high-water mark is
useful for discovery but cannot certify the complete inventory. Resolve new
replies to their actual roots and reconcile them before replacing the inventory.
Then read every marked root thread again after the final channel page, even when
channel history has no new row: it exposes reply counts, not reply content. Save
these reads in `threadSnapshots`. The checker requires status after the latest
human reply and channel/thread reads within 15 minutes; repeat the full bounded
scan and reread marked roots if stale. See
[`channel-inventory.md`](references/channel-inventory.md).

## Slack channels and ownership

For each scoped channel, run the exact channel-wide, bot-inclusive
`slack_search_public` query and exhaust every cursor, even after reaching the
cutoff. Do not narrow by terms, authors, reactions, or dates; do not use
`slack_read_channel` as the inventory. A supplied timestamp or permalink is
the inclusive lower bound. Follow
[`channel-inventory.md`](references/channel-inventory.md) for pagination,
root resolution, attachments, and the checker contract.

Classify every root as feedback or administrative. Read each report's full
thread and root reactions before claiming it. A different actor's eye plus a
current open status is owned elsewhere; do not claim or reply there. An eye
alone is permanent history, not ownership or open status. Leave unclear
ownership unresolved. Use one actor for this sweep's replies, reactions, and
read-backs. Put new workflow marks on the report root; legacy reply marks stay
with their source reply and never check off the root.

## Phase 0: claim and reconcile

Resolve known duplicates and finish one eligible root at a time. Reconcile
every report root owned by this actor, especially every eye-only root and
every root with a checkmark. Keep `👀` as permanent history and state the
current disposition in a concise, same-actor reply after the latest human
reply. Update that reply only when evidence, disposition, or next action
changes; read back the exact message and reaction state.

Add one root `✅` as soon as any named scope passes direct post-change proof,
including a partial fix or an open PR. List each proven scope and proof; keep
unproven scopes open. Add one root `🎫` only for a specific action accepted by
a named human, and retain it as history if completed. Never remove or duplicate
workflow marks. The status reply and reactions are both required. See
[`slack-reaction-replies.md`](references/slack-reaction-replies.md) for
ownership, proof, acceptance, reply, and historical-mark rules.

Fix defects or ask only for the reporter fact/action that gates progress.
Inspect supplied evidence and never ask for details already present. Trace
symptoms to their owner; one fix does not close a distinct unresolved symptom.

## Phase 1: answer the people who answered you

Answer new human replies on every root carrying this actor's `👀`, `✅`, or
`🎫` before newer reports, including roots with a checkmark; a checkmark never
hides a new answer. Skip another actor's root or a scope handed to another
task.

Use Slack as the ledger. Continue disclosure searches and reply scans from the
saved cursor; on the first run, use available history. Start a day before the
cursor because `after:` is date-only. Resolve hits to roots, check ownership,
and read the full thread. Count only a human reply after the question that
addresses it and lacks this workflow's disclosure; a newer answer reopens the
question. See
[`slack-reaction-replies.md`](references/slack-reaction-replies.md) for the
queries and cursor details.

- **Answered:** use the new evidence and try the fix before asking anything
  else. If the person says it is resolved elsewhere, record that source and
  close only that scope as **Resolved elsewhere**.
- **No answer, under four days:** wait without posting again.
- **No answer after four days:** mark **Abandoned - no answer in 4 days**;
  preserve existing reactions and carry any remaining internal work in the
  current status. Do not re-ask.

For legacy replies without a bot disclosure or eye, search once per connected
identity and inspect the author and full thread. End every new or edited Slack
reply with the exact sentence `this was sent from a bot.`; a connector footer
is not a substitute.

## Classification rules

Phase 0 applies these to parent-level claim decisions; Phase 2 reapplies them
after full-thread review.

**Automated diagnostics are feedback.** For Slack, gate before reading.
Before claiming, use only alert/link metadata. Follow
[`automated-diagnostics.md`](references/automated-diagnostics.md) for ownership,
claim, and stop/continue; inspect logs, tests, and artifacts only afterward.

**Defects and design feedback.** A clear bug has observable broken behavior: a
click or submit does nothing, an action errors, data is lost or reverted, the
result is wrong, or a working flow regressed. A credible "nothing happens" is
valid evidence — inspect the owning path before doubting the reporter.

Do not change code for an unrelated product idea, praise, status update, merge
or review request, irrelevant bot forward, duplicate, or work outside the
invocation's ownership.

**Subjective UX proposals need human review.** Adding buttons/chrome or changing
visibility, placement, emphasis, or discoverability is a proposal, not a
defect. Check overflow, keyboard, Cmd+K, and contextual surfaces. Recap the ask,
findings, options, recommendation, and tradeoff; mark **Skipped**. Even an
upvote routes these to human review. If claimed, reply **Skipped**; keep the eye
as permanent history and don't ask the reporter to choose.

Auto-fix objective defects only: broken behavior/results, misalignment,
overlap/clipping, illegibility, unusable focus/targets, jank, jitter,
measurable slowness, regressions. Separate defects from preferences; measure
failures with `text-heavy-ui`. Content remains Alice's unless claimed.

### `:upvote:` authorizes feature requests

Only an `:upvote:` from **the invoking identity** promotes an otherwise
out-of-scope feature request into scope. Subjective UX proposals still need
human review.

Find them alongside the newest-message scan:

```
slack_search: hasmy::upvote: in:<#CHANNEL>
```

`hasmy:` is already scoped to the connected identity you verified, so every
hit is an endorsement by definition. Hits are not self-evidently in scope —
the query also returns ordinary replies and old polls that happen to carry the
reaction. Take the ones that name a concrete improvement; skip the rest
without comment.

An upvote waives only the clear-bug bar; ownership, reaction, verification,
and question-budget rules stay unchanged.
Build the smallest eligible endorsed version, name Sid or Alice, and state
requested versus actual behavior in the recap. Add `👀` before investigation or
delegation and read it back. Keep new work evidence-limited until Phase 2's
four bars hold. Lack of an upvote prevents starting new feature work; it does
not prevent crediting an already-merged matching implementation: verify that
scope against Phase 2, record it **Fixed**, and add `✅` when its proof passes.

Don't search `has::eyes:`; use the owner or handoff path above.

For GitHub, Sentry, and first-party Agent-Native Analytics, use native state as
the cursor: recent open or unresolved items with no maintainer disposition,
deduplicated against Slack. If a source cannot be read, record it as
**unavailable**. Never report "nothing matched" for a source you could not
query.

### GitHub issues, Sentry, and Agent-Native Analytics are first-class feedback

Read each issue's body, comments, author, labels, linked PRs. Treat
prior `fixed`, `shipped`, or `merged` comments as leads; recheck the surface.
When a fix merges, record **Fixed** and link proof in the recap. Close a GitHub
issue only when this invocation explicitly authorizes it; otherwise record the
pending close. Track release/runtime gaps separately.

Before claiming an issue, check comments for handoffs. If someone offers a PR,
or Steve asks them to, mark **Owned elsewhere**; do not investigate, edit, test,
ship, reply, or close it. A direct request overrides this.

Fix root causes or ask what's blocking; triage human issues, not automated
finding mirrors covered by QA rollups. Feature requests and
subjective feedback need user/`:upvote:` authorization. Ask three questions max;
re-read before posting/closing.

Query both production Sentry projects - frontend/browser and backend/CLI -
paginate unresolved issues, and record representative events, releases, and
fingerprints. Classify each as repo-owned, external/provider,
deployment/configuration, or unclear. Fix repo-owned failures at the boundary
and verify locally. Use hosted runtime only when the full symptom cannot be
reproduced locally and hosted behavior is needed. Track release gaps separately;
don't hold a merged fix open. Record other external actions; silence or a stale
release doesn't prove the error is gone.

Query authenticated Agent-Native Analytics error issues in parallel. Use
`list-error-issues` for unresolved groups, then `get-error-issue` for stacks,
occurrences, breadcrumbs, tags, and replay links. It captures client exceptions
and server `captureError()` failures when the server Analytics key/provider is
configured. Use it as the Sentry fallback when rate-limited. Do not query
`error_issues` or `error_events` through
`query-agent-native-analytics`; use that action only for bounded event/LLM
correlation. Apply the same local-first rule. Fix worthwhile repo-owned failures
at their boundary; record external, deployment, or unclear issues without
inventing a fix.

### Chat run health

Run outcomes never reach Sentry; follow
[`chat-run-health.md`](references/chat-run-health.md).

### Deployment, release, and publish failures

Scan app/template, desktop, and package lanes every sweep, even without linked
feedback. Carry active run IDs, queued/running runs, failures, and missing/stale
artifacts across cursors. Fix repo causes; record external/manual causes with
the next owner/action. CI-red deploy rows from [CI triage](references/ci-red-report.md)
reuse this operational fingerprint. Follow
[`deployment-recovery.md`](references/deployment-recovery.md) for recovery and
target proof; keep delivery active until proof passes. A source issue may be
**Fixed** separately; delivery gaps are never **Quarantined**. Green CI or
merged source does not prove delivery.

## Phase 2: fix

Before changing code, read `fix-at-the-boundary`, `verifying-changes`, and
`concurrent-agents`. Read `ship` when a verified fix is ready to publish.

**Read the evidence the reporter already attached before forming a hypothesis.**
Open every screenshot, clip, and linked artifact. The error text in a
screenshot is usually the whole diagnosis. Track an artifact that is
permission-gated or expired separately from one that was never provided —
inaccessible is not absent.
For Slack, this includes `Files:` attached to both channel messages and thread
replies. Preserve each file ID/name/MIME type in the inventory, read the file's
contents, and include attachment-only replies in the latest-human-reply check;
blank message text does not mean the reply or evidence is absent. If file
contents cannot be opened, keep the scope unresolved and name the access limit.
Follow [`channel-inventory.md`](references/channel-inventory.md) for the
inventory fields and checker contract.

### Attempt local reproduction before evidence-limiting

For each concrete objective defect, try the reported flow before deciding it
cannot be reproduced or fixed. Trace the screenshot, URL, visible action, and
error through the app to its route, action, provider, or form contract; use
those clues to choose the closest runnable local seam. Exercise the flow with
a local build and synthetic fixtures. If its external dependency is unavailable,
mock that boundary or submit the same shape to a local validator. Do not use a
reporter's real email or create a real external record merely to prove a
failure.

Record the route or action, build, fixture, steps, expected and actual result,
and error. Code inspection alone is not a reproduction attempt, and
**Not reproducible - attempted** requires an actual flow attempt. Ask the
reporter only when a specific missing detail would change the attempt or fix;
otherwise make the best local attempt with the evidence already available.
If the attempt stops at a concrete access or environment limit, name what was
tried and what exact behavior remains untested. Measure misses with
`feedback-no-local-repro`.

**Sweep siblings before you claim anything is fixed.** Derive the fingerprint
from the symptom, not the file — the exact crashing token, call shape, or
literal — then search the repo for it and enumerate every hit in your recap
before editing. `fix-at-the-boundary` owns the method. A fix that repairs the
reported route and leaves the identical crash in its sibling is not a fix, and
the reporter was told otherwise.

### Repeats get more time, not the same fix again

Before fixing anything, search the channel for prior reports of the same
symptom:

```
slack_search: <2-4 distinctive symptom words> in:<#CHANNEL>
  sort=timestamp sort_dir=desc
```

Search in the reporter's words — `zoom invalid_client`, `logout twice` — not
your diagnosis. Read hits; one bug may have different descriptions.

**A repeat report after a Fixed claim is evidence that fix failed.** It is the
only falsification signal this workflow gets, and it outranks your belief that
the code is correct. Treat it as a stop, not a fresh report:

1. **Find what we said last time** — the prior thread, its **Fixed** reply,
   and the commit behind it. You want the claim that turned out wrong.
2. **Name why it did not take**: never deployed; fixed a sibling path; root
   cause misdiagnosed; or one symptom of several. Each needs a different
   repair, and re-applying the same class of change is how one bug ships
   three times.
3. **Reproduce end to end before editing, verify end to end after.** A passing
   unit test is not sufficient for a repeat — exercise the surface the reporter
   used. `verifying-changes` owns the proof.
4. **Cluster identical causes** into one investigation and fix, but keep a
   recap row per source thread; Phase 3's reply rules still apply.

Record `Repeat of: <link>` and the prior failed fix in each row; never call a
repeat fixed on the evidence that supported the earlier claim.

Measure this gate with friction keys `false-done` and
`repeat-report-refix`. Run `node scripts/agent-friction-report.mjs --weeks 2
--pattern <key>` for each before changing it and again later. A climbing count
requires a mechanical proof or release gate, not more prose.

### Reproduction and verification detail

Use [`reproduction-and-verification.md`](references/reproduction-and-verification.md)
for the bug-bash contract, reproduction ledger, and regression proof.

### Npx and package reports have a release follow-up

Use [`deployment-recovery.md`](references/deployment-recovery.md) for npx
version, registry, publication, and existing-app upgrade proof. A verified merge
may be **Fixed** while its delivery row stays open; a local scaffold or beta
promise is not delivery.

### Documentation has a runnable proof obligation

For each docs row, use [`documentation-proof.md`](references/documentation-proof.md).
A docs diff/build alone isn't proof.

Choose the narrowest seam the evidence supports:

- One isolated symptom → fix the owning local seam, add a regression check.
- Repeated or cross-surface symptoms → fix the shared primitive or contract.
- Missing capability or wrong tool → fix discovery, registry, or action wiring.
- Source-versus-live mismatch → diagnose build, deployment, or release state
  before changing source.

Never hard-code a rule for the wording of one report. One data point justifies
a local regression test or a contained fix; it never justifies a global agent
instruction or prompt exception.

## Phase 3: reply

Thank issue reporters for opening it and Slack reporters for sharing. While
work continues, name the concrete action and owner. If reporter input blocks a
fix, ask the direct question and say why the answer matters. Never send
**Open**/**pending** with only a symptom or evidence description. For
inaccessible artifacts, ask for the required access grant or share setting;
don't request a new link when the current one works. Follow
`address-feedback-with-replies`. End Slack replies with
`this was sent from a bot.`.

Short replies: say the change, limits, and next step. Link merged PRs and say
they're merged. Keep hashes, branches, CI, publisher, and run details in recap.
Beta fixes follow reference for timing and live status; state other availability
plainly.

Share only new or useful information.

### After a PR merges

Follow [`slack-reaction-replies.md`](references/slack-reaction-replies.md) for
post-merge beta ETAs and package replies.

For a fixed behavior with a ticketed handoff, state the done behavior and
remaining action/owner/ticket separately; don't imply the fixed scope is open.
Don't promise a ticket until created and assigned. Ask one targeted question if
needed. Do not reopen Slack in later runs to reply.

- **Fixed** / **Shipped** / **Live verified** meet Phase 2 bars. Recorded live
  observations may be silent; merged Slack fixes still get the reply above.
  **Shipped** is for upvoted improvements.
- **In progress** — name continuing work and its owner; ask nothing.
- **A question** — follow the rules below.

Unclaimed scope/noise gets an internal recap row. Cluster duplicates. Before
replying, apply the Slack ownership gate: stay out of other actors' marks and
active human work; reconcile your own inherited eyes.

### Ask only answerable questions

Ask one direct question per blocked defect only when its answer changes
reproduction or unblocks the fix. Keep one pending question per thread and try
the fix before following up. Never request supplied logs/IDs, internal
access/config/tooling, subjective choices, or irrelevant details. If a missing
user-visible link or ID blocks reproduction, ask for it and say where to find
it; for an inaccessible artifact, request a fresh link.

## Verification and identity

Follow the `## Slack identity` contract in `address-feedback-with-replies`:
confirm the connected profile is the invoking user before the first write, and
keep that identity for every read, reaction, reply, and read-back.

Resolve the Slack, GitHub, Sentry, and first-party Analytics error action
schemas once and reuse them.

For every Slack write: use the exact parent `thread_ts` from a full-thread
read, never a search-result or adjacent timestamp, and re-read after posting.
Do not close, label, or assign GitHub/Sentry items, or post unrelated comments,
unless the invocation authorizes it. For PR review feedback, first verify the
live PR author and follow `babysit-pr`: concise replies that disposition
feedback on the active user's own PR, including a recap for feedback found only
in a review body, need no extra authorization. On another person's PR, comment
only when the invocation explicitly authorizes comments on that exact PR;
otherwise draft the reply, leave the feedback unresolved, and link it in the
recap. This exception is only for PR review feedback, not proactive PR comments
or issue comments.

## Publishing

Use this worktree's branch and batch fixes with one
`corepack pnpm ship:push -m "<specific fix>"`; each head reruns CI. Sync
`origin/main` only for PR conflicts; use normal merges on shared branches.
Behind/pending is not a reason to sync.

Use `/ship` for PR ownership, push, and merge checks. Never push to another
person's PR without exact authorization. Push-only means `ship_mode=ready-only`;
merge requires separate authorization. Otherwise hand off as pending. Carry
evidence and dispositions into PRs, referencing only issues they fix. Keep
source-tested, built, deployed, and live-observed claims separate.

Carry tracker row IDs and reproduction ledgers into the PR or release recap;
tracker status is not shipping evidence. Mark every row independently and link
source/docs changes to their PR or commit, other dispositions to evidence or
owner.

If no fix is verified, say why shipping did not start. Unavailable connectors
and external failures are not blockers. **Clarification needed** stays open
with `👀` and no `✅`; it blocks independent fixes only if it could affect the
PR. Later runs reconcile the eye and new answers without restarting a verified
scope.

## Recap

Every eligible item gets a row. Report gated skips by count only, without
message details.

```md
## Feedback sweep

Start cursors: product [Slack message](...) · QA [Slack message](...) · dev [Slack message](...)
Reply cursors (reuse next run): product <timestamp> · QA <timestamp> · dev <timestamp>
Messages: product N · QA N · dev N (total N)
Deployment cursor: <timestamp> · carried active run IDs/rows: <ids/count>
Release lanes: N inspected · failed/stale N · target verified N
Reaction-gated skips: N · claimed N · answered N
Questions asked: N · Dropped at 4 days: N
Repeats of a prior Fixed claim: N (each with its earlier thread and failed fix)
Upvoted items in scope: N (built: N)

| Tracker/source or workflow run            | Reporter/owner | Status        | Repro or failed step                      | Pre/post/recovery         | Run/SHA/target/version/artifact/runtime proof | Locales             | Handoff (action/owner/ticket)      | Reply proof             | Reactions                                   |
| ----------------------------------------- | -------------- | ------------- | ----------------------------------------- | ------------------------- | --------------------------------------------- | ------------------- | ---------------------------------- | ----------------------- | ------------------------------------------- |
| 18 / [thread](...) or [workflow run](...) | ...            | <disposition> | steps; expected/actual or failed job/step | before/after/recovery run | source/tests/build/run/SHA/target/version/URL | updated/N/A/pending | none or action/owner/[ticket](...) | [reply](...) or blocker | 👀 claim; ✅ Fixed; 🎫 human handoff needed |

Sibling sweep: <fingerprint> - N hits, M fixed, K triaged
Tracker: <sheet/export and bounded range> - N rows enumerated, N ledgers complete
Unavailable or unverified: ...
```

**Open - no question** is ledger-only when reporter input cannot change the
internal next step; name the step and owner. Keep `👀`, no `✅`. If an answer
changes it, ask. "Nothing matched" requires successful queries and a cursor.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `fix-at-the-boundary`,
`concurrent-agents`, `verifying-changes`, `ship`, `ship-and-monitor`
