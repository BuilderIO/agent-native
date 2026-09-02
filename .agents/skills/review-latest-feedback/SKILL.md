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

Four phases, in order. Phase 0 comes before any investigation, not after.

0. **Claim** every item you intend to tackle with `👀`, before investigating
   any of it.
1. **Answer the people who answered you.** Older open questions first.
2. **Fix** what the evidence actually proves, at the owning boundary.
3. **Reply**, under a hard question budget, then recap.

The sweep's output is fixes. Slack replies are a side effect of having
something worth saying, never the unit of work. A run that fixes two bugs and
posts three messages beats a run that posts thirty.

## Phase 0: claim what you are taking

Other agents work this channel concurrently, so an unclaimed report is one
someone else is about to start investigating. The eye is a lock, not a
bookmark, and a lock taken after the work is worthless.

Enumerate the window with `slack_read_channel`, paginating on its cursor until
the window is covered, and classify from **parent-level evidence only**: the
message text, its attachments, and its existing reactions. That is enough to
tell a clear bug from a preference, and it is cheap. Do not open full threads,
read code, or investigate yet.

**`slack_search` is not a scan.** It ranks and truncates, so a channel-plus-date
query silently returns a subset and never promises every message. A run that
used search as its only cursor left a data-loss report — "undo made all my
slides blank", with a clip, deck id, and run id attached — unclaimed and
unanswered, alongside five other clear bugs. Search is for finding known
things: your prior replies, your eyes, repeat symptoms. Enumeration is the
channel read. State the message count you covered in the recap.

A channel read returns parents, so use its timestamps directly. The
full-thread-read rule below exists because *search* hits are usually replies —
resolve those through the permalink `thread_ts` before claiming.

Then add `👀` from the invoking identity to every item you intend to tackle,
and read the reactions back, in one pass before any deep read. A run that
identifies seven actionable reports and claims one has left six for a peer to
duplicate. Skip parents that already carry your eye.

Claiming is not working: Phase 0 only marks what you will take, never
investigates or replies, so it does not preempt the rule that older open
questions come before newer reports.

Phase 1's searches reach back past this window, so they surface parents the
channel scan never saw. Claim those the same way the moment they enter the
worklist — eye first, read back, then investigate. Claim-before-investigation
applies to every item you work, not only to the ones the scan found.

Claim generously and correct cheaply: if a deeper read shows an item is out of
scope or already owned, remove the eye. A retracted eye costs nothing; an hour
of duplicated investigation costs two agents. If the reaction write or
read-back fails, record the item as unavailable and stop working it — never
proceed on an unverified claim.

**The eye means "I have this," not "I owe you a message."** It carries no
reply obligation — that coupling is what produced 23 questions in one hour.
Every item gets a recap row; only some get a Slack reply.

Do not claim what you will not work: no preferences, product ideas, copy or
layout suggestions, praise, status updates, merge or review requests, bot
forwards, or duplicates. The classification rules are below.

"Duplicate" means the same message twice — a re-post or cross-post. **A fresh
report of a symptom we already answered is not a duplicate; it is the repeat
signal.** Claim and cluster it so Phase 2's repeat gate can run. Skipping it
is how a failed fix stays believed: someone says the bug is still there and we
file it as noise.

## Phase 1: answer the people who answered you

Every question you ask creates an obligation to come back for the answer.
Discharge it before reading anything new.

Slack is the ledger. Do not keep a local one — a per-run state file cannot
see the previous run, which is why the follow-up never happened. Run this
first, every time:

```
slack_search: "this was sent from a bot." in:<#CHANNEL>
  sort=timestamp sort_dir=asc include_context=true max_context_length=300
```

Two details are load-bearing; a run that changed them missed all eight of its
answered threads.

**`include_context=true` on every page, to the last.** Its `Context after`
block names who spoke after each reply, which is how you find answers without
opening ~80 threads. Dropping it on later pages to save tokens hides every
answer past page one — that alone caused the miss. Read the context, then open
only the threads where someone replied.

**Match the disclosure, nothing narrower.** Do not filter to replies ending in
`?`: a clarification often reads "if you can share a deck URL, that would help
us dig in" and carries no question mark at all, so narrowing drops real
pending questions. The context block, not the query, is what separates
answered from terminal.

**The parent is the permalink's `thread_ts`.** `Message_ts` is your own
reply's timestamp; acting on it targets the wrong message.

Also search for the invoking identity's eye-marked parents before applying the
disclosure filter:

```
slack_search: hasmy:eyes in:<#CHANNEL>
```

The test for "answered" is mechanical: **did a person speak after your
question?** Someone counts when their message carries no disclosure marker —
a disclosure-marked message is this workflow under any identity, so a later
run's own reply never counts as an answer to an earlier one.

Apply that test to the `Context after` block, then open the thread to read
what they actually said before acting. What the test decides is only whether
the thread enters the answered set, not whether the answer is sufficient: a
partial, unrelated, or "will check later" reply leaves the original question
pending under the one-question rule, and does not earn a second question.

A reply counts as answered **once**. If you already read it on an earlier
sweep and it left the question pending, it is not new evidence — leave the
thread pending, keep it out of `Answered since last run`, and do not let it
outrank newer work again. Only a message newer than your last look at the
thread re-enters the answered set. Otherwise one unhelpful reply would take
priority on every run forever.

Enumerate the answered set **before** any other work and write its count into
the recap's `Answered since last run` field. Searching is not working the
results — a run that finds eight answered threads and then spends itself on
newer reports has skipped the phase while appearing to satisfy it. A non-zero
count with none of those threads in your dispositions means the run is not
finished.

Then identify the latest disposition from
this workflow or its companion. Keep every unanswered **Clarification needed**
question in the pending-question set until it is answered, explicitly
resolved, or aged out at four days. **Fixed**, **Shipped**, and **In progress**
are not pending questions. Treat **Open - no reply** as terminal only for an
eye-only item with no outstanding clarification; it never replaces an
unanswered clarification question that is still inside its four-day window.

Only an unanswered **Clarification needed** thread enters the age branches
below — never one whose latest reply is **Fixed**, **Shipped**, or **In
progress**. If an older thread was recorded **Open - no reply** despite an
unanswered clarification, restore it to the pending set.

- **Someone answered** → highest priority in the run, ahead of every newer
  report: the evidence you said blocked you now exists. Rebuild it and attempt
  the fix. Reply **Fixed** only after all four bars pass; otherwise keep the
  clarification open. Never ask a follow-up before trying the fix.
  An answer that the issue is already resolved, fixed elsewhere, or not ours —
  a linked PR, "not a Clips issue" — is still an answer. Close it as
  **Resolved elsewhere** (terminal, and distinct from **Skipped**, which means
  out of scope): remove the `👀`, name who resolved it and where, post
  nothing. Removing the eye is what makes the closure durable, or the next
  run's `hasmy:eyes` resurfaces it as unfinished forever.
- **No answer, posted under 4 days ago** → leave it. Post nothing. A second
  message is a nag, not a follow-up.
- **No answer, posted over 4 days ago** → the question failed. Drop it
  silently: no reminder, no re-ask, no new reaction. Remove the `👀` and record
  **Abandoned - no answer in 4 days**, which is a terminal ledger disposition
  ranking with **Fixed** and **Open - no reply** — an expired thread keeps no
  eye and owes no reply, in this workflow or a standalone companion run. If the
  bug still matters, carry it forward as an internal investigation with no
  reporter dependency — dropping the question is not dropping the bug.

Four days is the retention rule, deliberately. A question unanswered for four
days will not be answered on day thirty, and an ever-growing open set becomes
the first thing every run reads, twice a day, forever. Expiry is what keeps
this phase cheap enough to run first.

Discovery is a separate concern from retention, which is why the search above
carries no `after` filter: a date-bounded cursor would miss an older question
still inside its window under a different clock. Search unbounded to **find**
them, then apply the age branches to what comes back. Finding an old question
does not exempt it from expiry.

Every new reply carries the disclosure, so the search above is the primary
cross-identity cursor. Legacy replies predating the marker need one more pass,
since they carry neither disclosure nor eye — run it once per valid workflow
identity, not just your own, or the claim that these searches cover every
run's questions is false:

```
slack_search: from:<EACH_WORKFLOW_IDENTITY> in:<#CHANNEL>
  sort=timestamp sort_dir=asc
```

Classify those hits by clarification wording such as `if you can share` — as a
filter on results, never as the discovery cursor itself.

These searches cover **every** run's questions, not just yours. Inspect the
author and full thread so a later run under another valid workflow identity
finds the existing question. Anything either search returns is already
handled - never re-ask it, whichever run posted it.

Search for the disclosure string, not for your own display name. Replies from
this workflow are the messages that carry it, and it survives edits. It is
also the only signal a reporter has that they are talking to a bot, so a reply
that ships without it is both undiscoverable here and a small lie in the
channel. Never omit it.

## Classification rules

Phase 0 applies these from parent-level evidence to decide what to claim.
Phase 2 re-applies them once the full thread is read, and retracts an eye that
no longer holds.

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
an otherwise out-of-scope item into scope and authorizes the work. It is the
endorsement that settles the product question: the person who would otherwise
route this away has read it and decided it should happen. Build it.

Do not wait for a second sign-off. The invoking identity is the authorization,
and treating their own endorsement as a request for someone else's permission
is how this rule becomes a no-op.

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
Content item still gets built — name Sid or Alice in the recap row so the
mapped owner is not surprised by a change in their area. Naming them is a
courtesy, not a gate: do not stall the work waiting for their reply.

Because the upvote already is the product decision, do not ask which variant
people would prefer. Ship the smallest version that delivers the endorsed
improvement, and let the reporter react to something real.

For every authorized upvoted improvement, add `👀` before investigation or
delegation and read the reaction back. Audit it in the same ledger as a clear
bug, using **Shipped** or **Open - no reply** as its terminal disposition.
This is the required eye-reaction procedure for upvoted improvements, not an
optional reminder.

Phase 0 already claimed these with `👀`. If an earlier run eyed something out
of scope, remove the reaction; do not post a compensating message.

Run an unbounded reaction search across identities as well:

```
slack_search: has:reaction in:<#CHANNEL>
```

Read each matching parent and its reaction metadata, retaining `👀` from any
valid workflow identity — `hasmy:eyes` optimizes the current identity's scan
but is never the only cursor. An eye-only clear bug or upvoted improvement
stays in the worklist until it reaches a terminal disposition, rediscovered
through that durable marker rather than dropping out with the scan window.

Group repeat symptoms into one cluster with one owning investigation; the
repeat gate in Phase 2 owns how they are worked.

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
2. **Name why it did not take**: never deployed; fixed a sibling path, not the
   reported one; root cause misdiagnosed; or one symptom of several. Each
   needs a different repair, and re-applying the same class of change is how
   one bug ships three times.
3. **Reproduce end to end before editing, verify end to end after.** A passing
   unit test is not sufficient for a repeat — exercise the surface the
   reporter used. `verifying-changes` owns the per-area proof.
4. **Cluster the reports**: one investigation and one fix, not one per report.
   Clustering changes the work, not the bookkeeping — every source thread
   keeps its own recap row, and Phase 3's reply rules apply unchanged.

Record `Repeat of: <link>` and the prior failed fix in each row so the next
run inherits the history instead of rediscovering it. Never tell a reporter a
repeat is fixed on the same evidence that supported the last claim.

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
Messages enumerated: N · Claimed: N · Answered since last run: N
Questions asked: N/3 · Dropped at 4 days: N
Repeats of a prior Fixed claim: N (each with its earlier thread and failed fix)
Upvoted items in scope: N (built: N)

| Source / item | Disposition | Replied? | Why and evidence |
| --- | --- | --- | --- |
| [Slack thread](...) | Fixed / Shipped / In progress / Asked / Open - no reply / Clustered / Resolved elsewhere / Skipped / Abandoned - no answer in 4 days | yes / no | ... |

Sibling sweep: <fingerprint> - N hits, M fixed, K triaged
Unavailable or unverified: ...
```

`Open - no reply` is a success state when the item is genuinely blocked on
investigation rather than on the reporter. "Nothing matched" is valid only
after each source was queried successfully, with the cursor stated.

## Related skills

`address-feedback`, `address-feedback-with-replies`, `fix-at-the-boundary`,
`concurrent-agents`, `verifying-changes`, `ship`
