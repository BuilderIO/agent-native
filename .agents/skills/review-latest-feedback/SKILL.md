---
name: review-latest-feedback
description: >-
  Sweep the newest Slack, GitHub issue, and Sentry feedback: first answer the
  reporters who answered you, then fix clear verified repo bugs at the owning
  boundary, build the UX and feature requests the invoking user endorsed with
  an :upvote:, reply only where the reply carries information, and recap every
  disposition. Use for scheduled or manual feedback sweeps.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

Four phases, in order. Phase 0 is not optional and is not last.

0. **Answer the people who answered you.** Older open questions first.
1. **Scan and classify** the bounded window, newest to oldest.
2. **Fix** what the evidence actually proves, at the owning boundary.
3. **Reply**, under a hard question budget, then recap.

The sweep's output is fixes. Slack replies are a side effect of having
something worth saying, never the unit of work. A run that fixes two bugs and
posts three messages beats a run that posts thirty.

## Phase 0: answer the people who answered you

Every question you ask creates an obligation to come back for the answer.
Discharge it before reading anything new.

Slack is the ledger. Do not keep a local one — a per-run state file cannot
see the previous run, which is why the follow-up never happened. Run this
first, every time:

```
slack_search: "this was sent from a bot." in:<#CHANNEL> after:<TODAY-5>
  sort=timestamp sort_dir=asc
```

Also search for the invoking identity's eye-marked parents before applying the
disclosure filter:

```
slack_search: hasmy:eyes in:<#CHANNEL>
```

Read each matching parent and reaction. An eye-only clear bug or authorized
upvoted improvement is durable work even when it has no reply; keep it in the
worklist until it has a terminal disposition.

For each hit, read its full thread and identify the latest disposition from
this workflow or its companion. Keep every unanswered **Clarification needed**
question in the pending-question set, regardless of age. **Fixed**, **Shipped**,
and **In progress** are not pending questions. Treat **Open - no reply** as
terminal only for an eye-only item with no outstanding clarification; it never
replaces an unanswered clarification question.

Do not apply either age branch below to a terminal disposition. The age branches
apply only when the latest status is an unanswered **Clarification needed**
question.

Only an unanswered **Clarification needed** thread may enter either age branch.
Never add a thread whose latest reply is **Fixed**, **Shipped**, or **In progress**
to the pending-question set. If an older thread was recorded **Open - no
reply** despite an unanswered clarification, restore it to the pending set.

- **Someone answered** → that is now the highest-priority item in the run.
  Rebuild the evidence and attempt the fix. Use a **Fixed** reply only after
  all four verification bars pass; otherwise keep the clarification open or
  ask one remaining specific question. Do not ask a follow-up before trying
  the fix.
- **No answer, posted under 4 days ago** → leave it. Post nothing. A second
  message is a nag, not a follow-up.
- **No answer, posted over 4 days ago** → keep it in the open-question set.
  Do not remind, re-ask, or add a reaction. Recheck it through the unbounded
  clarification search below and leave it as **Clarification needed** until it
  is answered or explicitly resolved. `Open - no reply` is reserved for work
  that has no outstanding clarification question.

`after:<TODAY-5>` bounds the new-message scan only. It is not a retention
policy for open questions. Before scanning newer messages, run a second search
without an `after` filter:

```
slack_search: "this was sent from a bot." in:<#CHANNEL>
  sort=timestamp sort_dir=asc
```

Read each matching workflow clarification thread and keep unanswered
questions in the worklist until they are answered or explicitly resolved. The
Slack thread is the durable record of its id and status; do not drop an open
question because it is old or because a new run has started.

New replies from the companion workflow must carry the disclosure marker, so
the unbounded marker search above is the primary cross-identity cursor. For
legacy companion replies that predate the marker, independently search every
valid workflow identity without an author filter or date cutoff and classify
each full thread before adding it to the pending set:

```
slack_search: from:<WORKFLOW_IDENTITY> in:<#CHANNEL>
  sort=timestamp sort_dir=asc
```

Use clarification wording such as `if you can share` or `would help us
investigate` only to classify messages returned by that broad search, not as a
finite discovery cursor. This legacy search is mandatory even when a message
has no bot disclosure or eye reaction; the unbounded identity search is the
companion workflow's independent discovery path.

These searches cover **every** run's questions, not just yours. Inspect the
author and full thread so a later run under another valid workflow identity
finds the existing question. Anything either search returns is already
handled - never re-ask it, whichever run posted it.

Search for the disclosure string, not for your own display name. Replies from
this workflow are the messages that carry it, and it survives edits. It is
also the only signal a reporter has that they are talking to a bot, so a reply
that ships without it is both undiscoverable here and a small lie in the
channel. Never omit it.

## Phase 1: scan and classify

Use the workspace's product feedback channel; here that is
`#product-agent-native-feedback` (`C0ATH3CCZT4`) unless the invocation names
another. Read newest to oldest through the declared window.

**Clear bugs only.** A clear bug has observable broken behavior: a click or
submit does nothing, an action errors, data is lost or reverted, the result is
wrong, or a working flow regressed. A credible "nothing happens" is valid
evidence — inspect the owning path before doubting the reporter.

Do not react, reply, question, or change code for a preference, product idea,
copy or layout suggestion, praise, status update, merge or review request, bot
forward, duplicate, or anything else. Design feedback, including Design clips
and imported-design usability, goes to Sid. Content belongs to Alice. Never
turn a subjective concern into a poll about which option people prefer.

### `:upvote:` overrides the clear-bug gate

An `:upvote:` from **the invoking identity** - not from anyone else - promotes
an otherwise out-of-scope item into scope for its mapped owner. It is the
endorsement that settles the product question, not a transfer of ownership.
Build it only when the mapped owner or an explicit assignment authorizes work
in that area.

Find them alongside the newest-message scan:

```
slack_search: hasmy::upvote: in:<#CHANNEL>
```

`hasmy:` is already scoped to the connected identity you verified, so every
hit is an endorsement by definition. Hits are not self-evidently in scope —
the query also returns ordinary replies and old polls that happen to carry the
reaction. Take the ones that name a concrete improvement; skip the rest
without comment.

An upvoted item is a **feature or UX change**, so it is exempt from the
clear-bug bar and from the demand for observable broken behavior. Everything
else still applies: it gets the same `👀`, the same fix-altitude gate, the
same verification, and it counts against the question budget.

The upvote overrides the bug gate, not the ownership map. An upvoted Design or
Content item stays with its mapped owner, Sid or Alice. Build it only with that
owner's authorization or an explicit assignment; otherwise route it to the
owner and do not change code. Name the owner in the recap row.

Because the upvote already is the product decision, do not ask which variant
people would prefer. Ship the smallest version that delivers the endorsed
improvement, and let the reporter react to something real.

For every authorized upvoted improvement, add `👀` before investigation or
delegation and read the reaction back. Audit it in the same ledger as a clear
bug, using **Shipped** or **Open - no reply** as its terminal disposition.
This is the required eye-reaction procedure for upvoted improvements, not an
optional reminder.

Add `👀` from the invoking identity to each clear bug or authorized upvoted
improvement as it enters scope, and read the reaction back. Do not add it to an
upvoted item that lacks the mapped owner's authorization; route that item
instead. **The eye means "I have this," not "I owe you a message."** It is an
investigation marker with no reply obligation - that coupling is what produced
23 questions in a single hour. If an earlier run eyed something out of scope,
remove the reaction; do not post a compensating message.

Run an unbounded reaction search across identities as well:

```
slack_search: has:reaction in:<#CHANNEL>
```

Read each matching parent and reaction metadata, retaining `👀` from any valid
workflow identity. `hasmy:eyes` may optimize the current identity's scan, but
it is never the only cursor. An eye-only clear bug or authorized upvoted
improvement remains in the worklist and is rediscovered through this durable
marker until it has a terminal disposition; it must not disappear when the
message falls outside the five-day scan.

Group repeat symptoms into one cluster with one owning investigation. Each
report keeps its own eye and its own recap row; the cluster gets one fix.

For GitHub and Sentry, use native state as the cursor: recent open or
unresolved items with no maintainer disposition, deduplicated against Slack.
If a source cannot be read, record it as **unavailable**. Never report
"nothing matched" for a source you could not query.

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
literal — then search the whole repo for it and enumerate every hit in your
recap before editing. `fix-at-the-boundary` owns the method. A fix that
repairs the route in the report and leaves the identical crash in the sibling
route is not a fix, and the reporter was told otherwise.

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

You may tell a reporter something is fixed only when all four hold:

1. You can name the reporter's **observed symptom** — the error text, the
   ignored click, the wrong value — not just a code smell near it.
2. Your check **fails before your change and passes after**, and it exercises
   that symptom. A test asserting that a prop got threaded through is not a
   regression test for "double-click schedules two emails."
3. The sibling sweep is clean, or the remaining hits are listed and triaged.
4. The change is in the snapshot that ships.

If any of the four is missing, it is not **Fixed**. Say what is true instead,
or say nothing and keep working. A confident wrong "fixed" costs more than
silence: the reporter stops watching, and the bug comes back as a new thread.

An upvoted improvement has no symptom to reproduce, so bar 1 becomes: you can
state the behavior the reporter asked for and the behavior that now exists.
Bars 2–4 hold unchanged — a new capability still needs a check that fails
without it. Call it **Shipped**, not Fixed; nothing was broken.

## Phase 3: reply

`address-feedback-with-replies` owns reply voice, wording, and the thank-first
rule. Follow it; do not restate or re-derive it here. Every reply from this
workflow ends with `this was sent from a bot.` after the plain-language status.

Reply only where the reply carries information the thread does not already
have. Three kinds qualify:

- **Fixed** / **Shipped** — all four bars above are met. Say it will be on
  beta later today. Use **Shipped** for an upvoted improvement.
- **In progress** — the thread already has real, concrete ownership (a named
  PR, a person actively working it). Acknowledge it; ask nothing.
- **A question** — subject to the budget below.

Everything else gets an eye, an internal recap row, and **no message**.
Silence is a valid disposition. A clear bug you investigated and could not
crack is recorded internally as open, not broadcast as a status update.
Never post the same sentence into multiple threads: if three reports share one
cause, reply in one and record the rest as clustered.

Before replying, re-read the full thread to the end. If a human is actively
working it, stay out — do not narrate over someone mid-conversation.

### The question budget

**At most three questions per run, across all sources.** This is a hard cap,
not a target. Most runs should ask zero or one.

The cap exists because the yield was measured. Earlier sweeps that asked one
or two sharp, thread-specific follow-ups got 7 of 8 answered, median 6.6
minutes. The 2026-09-01 sweep asked 23 templated questions in one hour and had
1 answer half an hour later — too soon to call a final rate, but a 20x drop in
early engagement against questions that used to land in minutes. Three of the
23 asked for something already attached to the parent message.

Volume is not coverage. It spends the channel's willingness to answer on the
questions that did not matter, and the ones that did go unanswered with them.

So rank before you ask. For each candidate, state: *if I get this answer, I
can ship the fix.* Ask the three with the strongest answer. If fewer than
three clear that bar, ask fewer. Everything below the cut is an internal open
item, not a message.

Never ask for:

- Anything already in the thread — a screenshot that is attached, an app the
  message is tagged with, a slide number that is in the linked URL, a file
  type the report already enumerated.
- A run ID, request ID, or session ID as the primary ask. Reporters often
  cannot get one — the `...` menu that exposes it is not always present — and
  a request that cannot be fulfilled reads as a brush-off. Prefer the surface
  URL, which they always have and which usually contains the same id.
- A build number, unless you have a specific reason to believe two builds
  behave differently and you will act on the answer.
- Anything you could determine yourself from source, logs, the linked
  artifact, or the deployed surface. Exhaust those first.
- A subjective product choice — including on an upvoted item, where the
  upvote already made the call. Build the smallest version instead of asking
  which variant they want.
- An internal blocker. Missing test tooling or a broken local install is your
  problem, never a reporter question.

At most one clarification question may be pending per thread at a time. Once it
is answered or resolved, attempt the fix; if that exposes a different required
detail, ask at most one new, non-repeating question. Never stack questions or
repeat a pending one. If a needed artifact is inaccessible to you, ask for a
fresh link - not for its contents again.

### Ask a fork, not for evidence

The questions that got fast answers named two candidate causes you had already
located and asked the reporter to pick:

> is the logout happening in the browser, the Desktop app, or both? that one
> detail will help isolate the session path.

> can you confirm whether the stop/pause controls are visible in the saved
> video itself, or only over the shared playback page while viewing it? the
> fix path differs between capture exclusion and player chrome.

The ones that went unanswered outsourced the investigation:

> can you share the Clips build and whether this happens in the native desktop
> bubble or the browser share page?

> can you share the run id for the .fig indexing failure?

The difference is who did the work first. A fork proves you already read the
code and narrowed it to two seams; the reporter spends five seconds and you
can ship. An evidence request means you have not started, and it reads that
way. If you cannot name the two candidate causes, you are not ready to ask —
go read the owning path.

Write it so they can answer in one line from memory, in their own words,
without opening a devtool.

## Verification and identity

Follow the `## Slack identity` contract in `address-feedback-with-replies`:
confirm the connected profile is the invoking user before the first write, and
keep that identity for every read, reaction, reply, and read-back.

Resolve the Slack, GitHub, and Sentry tool schemas once at the start of the run
and reuse them, rather than re-searching the catalog before each call. This is
minor — 2.6% of exec calls across 40 measured runs, 10% in the worst one — so
do it and move on; it is not worth a pass of its own.

For every Slack write: use the exact parent `thread_ts` from a full-thread
read, never a search-result or adjacent timestamp, and re-read after posting.
Do not close, label, assign, or comment on GitHub or Sentry unless the
invocation authorizes it; link them in the recap instead.

## Publishing

A worktree is a valid PR source — commit, push, and open or update the PR from
this worktree's branch and cwd. Use `corepack pnpm ship:push` for the complete
snapshot and update the existing PR rather than opening a second one.

With shipping authority — an explicit request, or a caller that already
granted it — continue straight into `ship` in the same worktree without asking
again. Without it, prepare the ready-to-ship handoff and say shipping is
pending authorization. Carry the start cursor, grouped reports, evidence
links, owning seam, sibling-sweep results, and every disposition into the PR
body. Keep source-tested, built, deployed, and observed-live claims separate.

If the sweep found no verified fix, finish with the recap and say why no ship
started. Clarifications, unavailable connectors, and external failures are
not shipping blockers.

## Recap

Every item inspected gets a row, including ones you deliberately stayed silent
on — that is how silence stays auditable.

```md
## Feedback sweep
Start cursor: [Slack message](...)
Answered since last run: N · Questions asked: N/3 · Dropped at 4 days: N
Upvoted items in scope: N (built: N)

| Source / item | Disposition | Replied? | Why and evidence |
| --- | --- | --- | --- |
| [Slack thread](...) | Fixed / Shipped / In progress / Asked / Open - no reply / Clustered / Skipped / Abandoned | yes / no | ... |

Sibling sweep: <fingerprint> - N hits, M fixed, K triaged
Unavailable or unverified: ...
```

`Open - no reply` is a success state when the item is genuinely blocked on
investigation rather than on the reporter. "Nothing matched" is valid only
after each source was queried successfully, with the cursor stated.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `fix-at-the-boundary`,
`concurrent-agents`, `verifying-changes`, `ship`
