---
name: review-latest-feedback
description: >-
  Sweep recent Slack, GitHub issues, Sentry, Agent-Native Analytics errors,
  actionable automated diagnostics, and linked-tracker feedback: answer
  reporters first, then fix verified bugs and actionable
  objective UI defects at the owning boundary, require human signoff for
  subjective UI changes, build features the invoking user endorsed with an
  :upvote:, and recap every disposition. Use for scheduled or manual sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

Four phases, in order. Phase 0 comes before any investigation, not after.

0. **Gate, then claim** every eligible item you intend to tackle with `👀`,
   before investigating any of it.
1. **Answer the people who answered you.** Older open questions first.
2. **Fix** what the evidence actually proves, at the owning boundary.
3. **Reply**, under a hard question budget, then recap.

Output is fixes; reply only when informative. Two fixes and three messages
beats thirty replies.

## Slack channels

Default channels: `#product-agent-native-feedback` (`C0ATH3CCZT4`),
`#qa-agent-native` (`C0C4U4XRT6X`), and
`#dev-agent-native-feedback` (`C0AJ5QV0J03`). Apply the full workflow to each:
use its `in:<#CHANNEL>` filter for searches and read each channel. Track
pagination, reply cursors, and counts separately. Honor narrower invocation
scope. Each channel uses the same five-day scan boundary; `#dev-agent-native-feedback`
is a default input, not a special-case exclusion.

## Slack ownership gate

Before reading Slack, inspect message and parent reactions. Skip checkmarks and
`👀` owned by another task, including replies and linked work. Only the active
task named in status may resume its own `👀`: verify ownership, reread thread
and reactions, then continue only its scope. Handoffs require the current
owner's explicit reply naming the new task and scope. Claims never expire. Ask
Steve if ownership is unclear; stop if another mark appears. For continuing
work, post one status reply with task link and remaining scope.

## Phase 0: claim what you are taking

For an eligible item you intend to take, add `👀` before investigation and
never remove it. Do not resume items excluded by the Slack ownership gate. Post
**In progress** only when work continues beyond this run.

**Defects are in scope: fix them or ask for the one detail needed to fix them.**
Investigate first; ask what they saw or did in plain language. Gather request
details and logs yourself; don't send reporters to developer tools.

The proposed remedy may be wrong while the bug is real. Trace the failure to
its owning boundary; do not reject it because the suggestion is unsuitable.

Record each symptom's disposition; subjective or out-of-scope feedback
doesn't close a separate defect. Tie each reaction to the scope it marks.

### Reaction gate

`👀` is claim history; `✅` requires **Fixed** after all Phase 2 bars. `🎫`
marks accepted work another owner must do; use it only with an existing ticket
naming that owner and exact action, linked in the ledger and reply. No `🎫` for
fixed scope, routine rollout, optional live checks, subjective/out-of-scope, or
unapproved work. Pair `✅` + `🎫` only for distinct scopes; name the fixed
behavior and ticket action. **Shipped**/**Live verified** alone don't earn
`✅`. Never remove reactions.

If no safe repo-owned fix is evident, record the evidence limit. Ask only a
question that could unblock a fix; after four days without an answer, record
**Abandoned - no answer in 4 days**.

Use **Skipped** only for non-defects, never breakage. **Open - no question**
means you found neither a fix nor a useful question; state why in the thread.

### Authoritative disposition vocabulary

For eligible items, use one disposition per row; record it in the recap and, if
unstated, in the thread or linked work. Do not inspect gated items for status.
For clusters, post one owner status with each source permalink and
**Clustered**; reply in a non-owner only for a distinct question or update.

- **Terminal (keep this workflow's eye):** **Fixed**, **Shipped**, **Live
  verified**, **Open - no question**, **Resolved elsewhere**, **Skipped**,
  **Clustered**, or **Abandoned - no answer in 4 days**. Apply the reaction
  gate above.
- **Active (retain 👀):** **Verified locally**, **Built - live unverified**,
  **Deployed - live unverified**, **Not reproducible - attempted**, or
  **In progress**.
- **Waiting on reporter (retain 👀):** **Asked**, **Clarification needed**, or
  **Blocked on reporter**. Find these through Phase 1's question search.
- **Owned elsewhere:** use only for an unmarked item when accessible evidence
  confirms an active owner; marks owned by another task are skipped by the
  ownership gate.

After merge, mark **Fixed** when the source fix is verified. Track
release/runtime separately; normal rollout and optional live checks neither
reopen it nor warrant `🎫`. Follow up only on accepted work outside this run;
record source, target, owner, exact action, and verification. Don't reopen
closed fixes.
**Clustered** closes one row but retains it.

Enumerate channel parents newest backward through `next_cursor` until older
than 5 days. Check reactions first; skip marked messages.

**`slack_search` can rank and truncate.** Use channel reads to enumerate parents
and put their count in the recap. Sort targeted searches oldest-first and follow
`next_cursor` until exhausted.

Search hits are often replies; resolve `thread_ts` and check parent reactions
before reading the hit or opening the thread.

Read back each new `👀` once. Resume only through the verified owner or handoff
above; never resume checkmarked items.

Claiming does not investigate. Read back new claims. Do not claim out-of-scope
items. If a current-run claim proves out of scope, keep `👀` and post **Skipped**
once without a question. New evidence or upvotes never override the ownership
gate.

Record eligible claims and dispositions; report gated skips in aggregate only.
Cluster fresh repeats for Phase 2.

### External trackers are evidence, not status

For a supplied spreadsheet, export, test matrix, or tracker, read metadata then
the bounded range with its named connector. Enumerate every row and its
completion status; retain its id, reporter, symptom, status, retest, and source
link.

Status, reactions, a merged PR, a source diff, or a unit test is not behavior
proof. Each row needs a post-change ledger result. If it cannot be read, say
**tracker unavailable**, never "no matches."

## Phase 1: answer the people who answered you

Answer eligible questions first; the ownership gate excludes prior-run marked
questions, even if a reporter has since replied.

Slack is the ledger; a per-run state file cannot carry state across runs. First,
exhaust this search to enumerate prior questions and context:

```
slack_search: "this was sent from a bot." in:<#CHANNEL>
  sort=timestamp sort_dir=asc include_context=true max_context_length=300
```

Keep context and exhaust pages; include human replies regardless of
punctuation. Open only eligible threads with a human reply.

**The parent is the permalink's `thread_ts`.** `Message_ts` is your own
reply's timestamp; acting on it targets the wrong message.

Find replies even when their parent is older than the five-day scan. Read this
channel's prior reply-scan cursor; without one, scan all available history. A
new reply can belong to an old disclosure, so search all channel messages over
an overlapping date window instead of cursor-filtering the disclosure search:

```
slack_search: in:<#CHANNEL> after:<YYYY-MM-DD>
  sort=timestamp sort_dir=asc
```

Filter hits by their timestamp, resolve parent `thread_ts`, and check reactions
first. Skip marked parents without opening threads. Never filter by the older
parent timestamp; `after:` is date-only, so start a day earlier and exhaust
pages. Advance the cursor to the greatest processed hit.

Count a question answered only when a person posts after it without this
workflow's disclosure marker; read the thread to reject partial, unrelated, or
deferred replies. Count each answer once; only a newer message reopens it.
Enumerate answered threads before new work and recap the count. Keep unanswered
**Clarification needed** pending until answered, resolved, or four days old;
other dispositions do not substitute. Reapply Phase 0 eye/checkmark rules.

Apply the age branches only to unanswered **Clarification needed** threads;
restore any such thread mistakenly marked **Open - no question**.

- **Someone answered** → highest priority in the run, ahead of every newer
  report: the evidence you said blocked you now exists. Rebuild it and attempt
  the fix. Reply **Fixed** only after all four bars pass; otherwise keep the
  clarification open. Never ask a follow-up before trying the fix.
  An answer that the issue is already resolved, fixed elsewhere, or not ours —
  a linked PR, "not a Clips issue" — is still an answer. Close it as
  **Resolved elsewhere** (terminal, and distinct from **Skipped**, which means
  out of scope): keep our `👀` and record who resolved it and where. The
  participant's reply is the status; do not add `✅`.
- **No answer, posted under 4 days ago** → leave it. Post nothing. A second
  message is a nag, not a follow-up.
- **No answer, posted over 4 days ago** → the question failed. Do not remind or
  re-ask. Keep the `👀`, record **Abandoned - no answer in 4 days** once in the
  thread without a new question, and carry any still-relevant bug forward as an
  internal investigation.

Search without `after`, then apply the four-day expiry; disclosure is the
cross-identity cursor. For legacy replies without disclosure or eyes, run once
per valid workflow identity:

```
slack_search: from:<EACH_WORKFLOW_IDENTITY> in:<#CHANNEL>
  sort=timestamp sort_dir=asc
```

Classify these hits by clarification wording (for example, `if you can share`),
not as the discovery cursor. Inspect author and full thread; never re-ask a
result from either search. Search the disclosure string, not a display name,
and include it in every reply.

## Classification rules

Phase 0 applies these from parent-level evidence to decide what to claim.
Phase 2 reapplies these rules after full-thread review.

Use `## Slack channels` unless the invocation narrows scope.

**Automated diagnostics count as feedback regardless of author.** Claim
actionable CI/Beta E2E and monitoring alerts with `👀` after the ownership gate,
then inspect linked runs, builds/commits, job logs, test results, artifacts, and
issue state. Treat labels/counts as leads. Fix verified repo-owned causes; for
other causes, record evidence and the next owner/action. Don't ask bots; ask a
person only when a fact blocks a fix. If our report lacks evidence, improve its
checks/report with concise context and links; avoid duplicate details and
secrets.

**Defects and design feedback.** A clear bug has observable broken behavior: a
click or submit does nothing, an action errors, data is lost or reverted, the
result is wrong, or a working flow regressed. A credible "nothing happens" is
valid evidence — inspect the owning path before doubting the reporter.

Do not change code for an unrelated product idea, praise, status update, merge
or review request, irrelevant bot forward, duplicate, or work outside the
invocation's ownership.

**Keep subjective UI changes human-in-the-loop.** Automatically fix only
objective UI defects: broken interactions, misalignment, overlap or clipping,
unusable controls, or removing clear excess clutter. A reporter request is not
product signoff. Discoverability complaints and preferences do not authorize
adding, promoting, moving, or duplicating buttons or other persistent chrome.
Check overflow, keyboard, Cmd+K, and contextual surfaces first. Adding or
promoting chrome requires the invoking user's explicit current-task request or
  :upvote:` below. Otherwise mark **Skipped**. If this run already claimed it,
  keep our `👀`
  and post **Skipped** once if the thread does not state it; do not ask the
  reporter to decide. Measure failures with `text-heavy-ui`.

Requests for a new capability still follow the invoking identity's `:upvote:`
gate. Content remains Alice's area unless the invocation claims it.

### `:upvote:` authorizes feature requests

An `:upvote:` from **the invoking identity** - not from anyone else - promotes
an otherwise out-of-scope item into scope and authorizes the work. It is the
endorsement that settles the product question: the person who would otherwise
route this away has read it and decided it should happen. Build it.

Find them alongside the newest-message scan:

```
slack_search: hasmy::upvote: in:<#CHANNEL>
```

`hasmy:` is already scoped to the connected identity you verified, so every
hit is an endorsement by definition. Hits are not self-evidently in scope —
the query also returns ordinary replies and old polls that happen to carry the
reaction. Take the ones that name a concrete improvement; skip the rest
without comment.

An upvoted item is a **feature or UX change**: it skips only the clear-bug bar,
not `👀`, fix-altitude, verification, or question-budget requirements. The
upvote overrides the bug gate, not ownership; build the smallest endorsed
version and name Sid or Alice in the recap. Add `👀` before investigation or
delegation and read it back. Keep an evidence-limited disposition until Phase
2's four bars hold; then use **Shipped**, adding `✅` only if it also meets
**Fixed**.

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

Fix every defect at its root or ask an unblock question; do not
skip old, bot-filed, or maintainer-commented issues. Feature requests and
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

## Phase 2: fix

Before changing code, read `fix-at-the-boundary`, `verifying-changes`, and
`concurrent-agents`. Read `ship` when a verified fix is ready to publish.

**Read the evidence the reporter already attached before forming a hypothesis.**
Open every screenshot, clip, and linked artifact. The error text in a
screenshot is usually the whole diagnosis. Track an artifact that is
permission-gated or expired separately from one that was never provided —
inaccessible is not absent.

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
your diagnosis. People describe one bug differently, so read the hits rather
than trusting the count.

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

### Bug-bash reproduction contract

For Design, Slides, Core/framework, and template bashes, the reachable reported
surface is the contract:

1. **Reproduce before editing.** Use the exact URL/route, app/template,
   account/workspace/role, build/package, browser/device, fixture, and inputs;
   record expected/actual, errors, and attached artifacts.
2. **Sweep siblings and boundaries.** Test a negative control plus empty, wrong,
   whitespace, case, and permission variants; enumerate every shared fingerprint.
3. **Repeat on the changed running artifact.** Rerun the flow, refresh/navigate,
   read UI and persisted state, and cover failure/retry/cancel/async paths.
   Destructive flows require wrong/partial/exact confirmation and recovery;
   do not delete unless needed.
4. **Test release/race layers when needed.** Use concurrency/10 runs, a clean
   scaffold, and the exact package for package reports. Reproduce and verify
   locally by default; use beta only if the full symptom cannot be reproduced
   locally and hosted behavior is needed. Record why. These checks support
   **Shipped**/**Live verified**, not a merged **Fixed** claim.
5. Record untested layers. Before merge, use an evidence-limited status. After
   verified source merge, mark **Fixed** even if release/live layers remain;
   routine rollout and optional beta checks aren't ticketed follow-ups.
   **Shipped**/**Live verified** need their own bars. Don't mark **Fixed**/`✅`
   without merged-source proof. Reopen repeats only with a fresh failing
   pre-change reproduction.

### Reproduction ledger - required for every row

For each row, record symptom/surface, reproduction steps and account, expected
and pre/post behavior, tested commit/build, sibling results, untested layers,
and runtime layer (`local`, `source-only`, `built`, `deployed`, `observed-live`).

Without merged source proof, use an active or waiting disposition above. After
merge, **Fixed** may coexist with release follow-up; **Live verified** requires
all four bars. Status labels, reactions, and tests alone do not prove closure.
Repeats require a new pre-change failure and link the earlier false claim.

Regression claims require Red/Green proof: reverse-apply hunk with
`git apply -R`, record failure, reapply, record pass. Repeat timing checks 10x.
If output missing, build it and rerun on `origin/main` before calling them
pre-existing.

### Npx and package reports have a release follow-up

Npx scaffolds are versioned. Record pinned/filed versions, fresh npm cache/no
local override, candidate result, release, and existing-app path (`pnpm add
@agent-native/core@<version>` or hand edit).

Local proof, beta promises, and scaffolds aren't **Shipped**/**Live verified**
until published. A verified merge is **Fixed**; follow the issue-closure rule
above. Record merge proof, release, verification, and bump/re-scaffold
follow-up. Unknown package/endpoint context is a release follow-up. Ask only if
scope or reporter input is unclear. Missing evidence alone doesn't keep a
verified merge open.
Merge/beta is not npx delivery.

### Documentation has a runnable proof obligation

For each docs row, copy commands into a clean temporary scaffold; verify every
referenced file, directory, script, env var, deploy target, link, and fence
order. A docs diff/build is not enough. Update configured locales and run
`guard:i18n-catalogs` plus `guard:i18n-changed-copy`.

Choose the narrowest seam the evidence supports:

- One isolated symptom → fix the owning local seam, add a regression check.
- Repeated or cross-surface symptoms → fix the shared primitive or contract.
- Missing capability or wrong tool → fix discovery, registry, or action wiring.
- Source-versus-live mismatch → diagnose build, deployment, or release state
  before changing source.

Never hard-code a rule for the wording of one report. One data point justifies
a local regression test or a contained fix; it never justifies a global agent
instruction or prompt exception.

### The bar for saying "Fixed"

Phase 2 defines the proof bars for **Fixed**, **Shipped**, and
**Live verified**. Upvoted improvements state requested versus actual behavior
and use **Shipped**.

## Phase 3: reply

Thank issue reporters for opening it and Slack reporters for sharing. Give the
status or ask a useful question. Follow `address-feedback-with-replies` for
Slack voice. End each Slack reply with `this was sent from a bot.` after its
plain-language status.

Use everyday words for nontechnical readers. In one short paragraph, say what
we did, what we didn't do when relevant, and what's next. Give a simple reason
when useful. Keep technical proof in the recap or PR.

Share only new or useful information.

### After a PR merges

After a Slack-fix PR merges, reply only in threads claimed this run.

For beta app fixes, check the merge-triggered publisher run before giving the
normal few-hours ETA. This checks release-job status, not beta behavior. If it
succeeds, say what changed and that it'll be on beta in the next few hours.
Keep test environment, verification, publisher results, and rollout details out
of the reply; record evidence in the recap or PR. If the run is missing or
failed, omit the ETA and state what's done, the exact remaining action and owner,
and an existing ticket when available. Apply the Reaction gate before `🎫`.
For packages, state availability without verification details.

For a fixed behavior with a ticketed handoff, state the done behavior and
remaining action/owner/ticket separately; don't imply the fixed scope is open.
Don't promise a ticket until created and assigned. Ask one targeted question if
needed. Do not reopen Slack in later runs to reply.

- **Fixed** / **Shipped** / **Live verified** meet Phase 2 bars. Recorded live
  observations may be silent; merged Slack fixes still get the reply above.
  **Shipped** is for upvoted improvements.
- **In progress** — name continuing work and its owner; ask nothing.
- **A question** — subject to the budget below.

Unclaimed scope/noise gets an internal recap row. Ask about an unverified defect
only when one answer would unblock it; otherwise record **Open - no question**
once. Cluster duplicates. Before re-reading any thread to reply, apply the Slack
ownership gate; stay out of marked messages and active human work.

### The question budget

**At most three questions per run, across all sources.** Most runs ask zero or
one.

So rank before you ask. For each candidate, state: *if I get this answer, I
can ship the fix.* Ask the three with the strongest answer. If fewer than
three clear that bar, ask fewer. Everything below the cut is an internal open
item, not a message.

Never ask for supplied/inspectable evidence, irrelevant IDs/build numbers,
subjective choices, or internal blockers. If a user-visible link or ID is the
sole blocker, ask plainly and say where to find it.

At most one clarification question may be pending per thread at a time. Once it
is answered or resolved, attempt the fix; if that exposes a different required
detail, ask at most one new, non-repeating question. Never stack questions or
repeat a pending one. If a needed artifact is inaccessible to you, ask for a
fresh link - not for its contents again.

## Verification and identity

Follow the `## Slack identity` contract in `address-feedback-with-replies`:
confirm the connected profile is the invoking user before the first write, and
keep that identity for every read, reaction, reply, and read-back.

Resolve the Slack, GitHub, Sentry, and first-party Analytics error action
schemas once and reuse them.

For every Slack write: use the exact parent `thread_ts` from a full-thread
read, never a search-result or adjacent timestamp, and re-read after posting.
Do not close, label, assign, or comment on GitHub or Sentry unless the
invocation authorizes it; link them in the recap instead.

## Publishing

Use this worktree's branch. Batch fixes with one
`corepack pnpm ship:push -m "<specific fix>"`; each head reruns CI. Sync
`origin/main` only for GitHub conflicts; prefer normal merges on shared
branches. Behind/pending never justify syncing.

Use `/ship` for PR ownership, push, and merge checks. Never push to another
person's PR without explicit authorization for that exact PR in this request.
Push-only authorization means `ship_mode=ready-only`; merging requires separate
authorization for that PR. Without push authorization, hand off as pending.
Carry feedback evidence and dispositions into PRs; reference only issues the
PR fixes.
Keep source-tested, built, deployed, and observed-live claims separate.

Carry exact tracker row ids and the reproduction ledger into the PR or release
recap; tracker status is not shipping evidence. Mark each row independently: a
reaction, checkmark, or "reviewed" cannot cover multiple rows, including
expected, docs-owned, cross-team, or duplicate items. Link each source/docs
change to its exact PR or commit, and each non-coding disposition to its
evidence or owner.

If no fix is verified, recap why shipping did not start. Unavailable connectors
and external failures are not shipping blockers.
While waiting, **Clarification needed** stays open with `👀` and no `✅`; it
must not block independent fixes unless it could affect a PR change. Later runs
skip the eye under the ownership gate.

## Recap

Every eligible item gets a row. Report gated skips by count only, without
message details.

```md
## Feedback sweep
Start cursors: product [Slack message](...) · QA [Slack message](...) · dev [Slack message](...)
Reply cursors (reuse next run): product <timestamp> · QA <timestamp> · dev <timestamp>
Messages: product N · QA N · dev N (total N)
Reaction-gated skips: N · claimed N · answered N
Questions asked: N/3 · Dropped at 4 days: N
Repeats of a prior Fixed claim: N (each with its earlier thread and failed fix)
Upvoted items in scope: N (built: N)

| Tracker/source | Reporter | Status | Repro (expected/actual) | Pre/post | Runtime proof | Locales | Handoff (action/owner/ticket) | Replied | Reactions |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 18 / [thread](...) | ... | <disposition> | steps; expected/actual | before/after | source/tests/build/URL | updated/N/A/pending | none or action/owner/[ticket](...) | yes/no | 👀 claim; ✅ Fixed; 🎫 ticketed only |

Sibling sweep: <fingerprint> - N hits, M fixed, K triaged
Tracker: <sheet/export and bounded range> - N rows enumerated, N ledgers complete
Unavailable or unverified: ...
```

`Open - no question` is a last resort, not a success state. It requires that
you worked the defect, could not fix it, and could not form a question that would
unblock it; a run whose ledger is mostly `Open - no question` has under-asked, not
finished. It keeps our eye and has no checkmark. "Nothing
matched" is valid only after each source was queried successfully, with the
cursor stated.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `fix-at-the-boundary`,
`concurrent-agents`, `verifying-changes`, `ship`
