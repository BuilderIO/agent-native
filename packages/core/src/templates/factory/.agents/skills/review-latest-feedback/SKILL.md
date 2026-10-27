---
name: review-latest-feedback
description: >-
  Sweep recent feedback (the Slack feedback channels, GitHub issues, CI on
  main, Sentry, Analytics errors, chat run health, deploys), fix as many real
  bugs as possible, ship them in one PR, then close the loop on every Slack
  report with 👀/✅/🎫 and one short plain-English reply. Use for scheduled or
  manual feedback sweeps, usually followed by /ship.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Review Latest Feedback

The job: find what's broken, fix as much of it as you can, ship it, and tell
each reporter in one friendly sentence what happened. A sweep is judged by
bugs fixed and merged, and by every claimed report getting a clear answer. It is
not judged by ledgers, receipts, or checker output, so don't produce them.

## The contract

Slack reactions on a report's root message mean exactly this:

| Mark | Meaning                                   | When to add                                                                                      |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 👀   | "I'm on this"                             | Before you investigate, and only on reports you will finish answering in this run               |
| ✅   | "Fixed"                                   | After the fix is merged to `main` (main deploys to beta automatically)                           |
| 🎫   | "Needs a person"                          | A product call, access or credentials, info from the reporter, or a fix you couldn't land        |

Steve (`U0GCV21HC`) steers the sweep with his own reactions on a root:

| Steve adds   | Meaning                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------------- |
| `:mag:`      | Don't work on this; someone else will. Wins over everything below                             |
| `:yes-party:`| Definitely do this, even if it looks ambiguous or like a UX change. Build the smallest version that does what was asked |
| `:upvote:`   | Same as `:yes-party:` for a feature request                                                    |
| 👀 by hand   | He's working on it himself; leave it (see "Open items first" for how to tell his 👀 from ours) |

Reactions can't be removed through the Slack connector, so never add one you
might need to take back. Every 👀 you add ends the run with a reply, plus
either ✅ or 🎫, or a fix PR that is still open and lists the report (its
merge adds the ✅). A 👀 with no follow-up is the most common complaint about this workflow.

Every claimed report gets **one** reply in its thread per outcome. People
have pushed back on replies that were long, technical, condescending, vague
about who does what next, or that handed them work. Each reply must be:

- **Short:** one sentence, about 25 words at most, for someone who doesn't
  read code.
- **About what they'll notice:** say what changes for them ("recordings no
  longer get stuck on Saving"), not how it works ("cleanup now waits for the
  transcript"). Leave out file, function, and service names, CI, logs, runs,
  "verified", "scope", status labels ("In progress:", "Blocked on human
  owner:", "Open - no question:"), and any mention of this workflow.
- **Clear on who does what next:** "I'll ..." or a named person ("Sid will
  decide ..."). Never "the team", "product", "the framework team", "the
  owner", or "someone". If you don't know who owns it, say you've passed it
  to Steve. Never @-mention anyone.
- **Not a to-do list for them:** look things up yourself first (the
  message's time and author, their account and recent activity, logs, the
  linked page or screenshot). Ask only when nothing else can unblock it, and
  then ask one small thing, in this one reply. Never send a list of
  questions, never ask them to test, retry, re-record, or gather logs, and
  never come back later asking for something you could have asked the first
  time.
- **Plain, not preachy:** don't explain how the product works unless they
  asked, don't tell them what they should do, and skip apologies, hedging,
  "actually", "just", "simply", and "Great catch!!".
- **True:** "on beta shortly" only after the merge. Before that, the fix is
  "in review".
- Link the PR on the word "fix" (`<url|fix>`), never by number.
- End with the bold line `**This was sent from a bot**` on its own line,
  once.

Don't reply at all to jokes, banter, or a thread a person is already
handling. Before posting, reread the reply as the reporter: would they get it
in five seconds, know who does what next, and feel we did the legwork?

Good (each is the first line; the footer goes on the line below it):

- `thanks for flagging - <https://github.com/BuilderIO/agent-native/pull/1234|fix> is merged and will be on beta shortly.`
- `thanks - the export now keeps your column order (<https://github.com/BuilderIO/agent-native/pull/1234|fix>); it's in review now.`
- `thanks - moving that button is a product call, so I've passed it to Steve.`
- `thanks - I couldn't find which deck this was; could you paste its link?`

So a full reply looks like:

```text
thanks for flagging - <https://github.com/BuilderIO/agent-native/pull/1234|fix> is merged and will be on beta shortly.
**This was sent from a bot**
```

Real replies that missed, and what to send instead:

| Sent | Instead |
| --- | --- |
| "Could you send the recording link, approximate time, and browser so we can trace whether the clip produced media before it tried to save?" | Find the recording from the reporter and message time first. If you still can't: "thanks - I couldn't find which recording this was; could you paste its link?" |
| "cleanup now waits for the transcript, and a fix is ready. It should be on beta shortly." (sent before the merge) | "thanks - recordings will keep their transcript once this <url\|fix> is merged; it's in review now." |
| "I've left moving it somewhere easier to find for product to decide." | "thanks - where the editor lives is a product call, so I've passed it to Steve." |
| "The framework team needs to decide whether multi-step work should be gathered into one request or handled through the agent's usual back-and-forth." | "thanks - this needs a design decision, so I've passed it to Steve." |
| "Thanks for correcting me, Julia - I misread the replies. ... Open - no question: I don't have enough source evidence to claim a fix." | Nothing: the thread was a joke. |
| Asked for the app URL, what was clicked, and the time; then, in a second reply, for the time zone. | One reply, one question, only for what you can't look up. The message's own timestamp already says when. |

## Boundaries

- **Slack:** only `#product-agent-native-feedback` (`C0ATH3CCZT4`),
  `#qa-agent-native` (`C0C4U4XRT6X`), and `#dev-agent-native-feedback`
  (`C0AJ5QV0J03`), or the narrower set the invocation names. Never react or
  reply anywhere else.
- **Leave a report alone** when:
  - Steve put `:mag:` or his own 👀 on it (table above);
  - someone in the thread asked a specific person to look, a teammate says
    they're handling it, or Steve asked for a human on it;
  - another person's 👀 sits on it and they've been active in the last 3
    days;
  - an earlier run's PR for it is still open. That PR's `/ship` closes the
    report out when it merges.
- **PRs:** push to, comment on, or merge only PRs authored by the active
  GitHub login (`gh api user --jq .login`). Never touch anyone else's PR unless
  the invocation names that exact PR and action.
- **One run, one PR.** Work only on the PR this run opened. Every sweep PR is
  authored by Steve's login, so the author check can't tell runs apart: an
  open PR with a `Reports` section that this run didn't open belongs to
  another run that may still be working on it. Don't push to, reply on, or
  merge it; list it under "Still open from earlier runs".
- **Goals end with the run.** If you set a Codex goal, scope it to this run:
  name its PR once you have one, and end it after step 6 ("merge PR #N,
  close its Reports, append the recap"). Never set an open-ended goal such as
  "review feedback" or "fix Steve's open PRs". Goals resume after restarts,
  so an open-ended one keeps running into the next scheduled sweep and
  collides with it.
- Use the connected Slack integration for every Slack read and write. Confirm
  the connected profile is Steve before the first write.

## 1. Collect (keep it under ~15 minutes)

Work in a task-owned worktree on fresh `origin/main`. If you start in a shared
checkout, or the expected worktree is missing, create one
(`git worktree add <path> origin/main`) and carry on. That is never a reason
to stop.

Window: the last 5 days for new reports (or from the timestamp or permalink
the invocation gives), plus 14 days for open items.

- **Read the channels.** Use `slack_read_channel` with
  `response_format: detailed` (paginate) back 14 days. Its output shows
  reaction counts but not who added them, so call `slack_get_reactions` on any
  root showing `eyes`, `white_check_mark`, `ticket`, `mag`, `yes-party`, or
  `upvote`. Don't rely on
  `hasmy:` searches, which have returned nothing for roots that do carry
  Steve's marks.
- **Open items first.** Every run posts as Steve, and Steve also adds 👀 by
  hand to things he is working on himself, so a 👀 from his account is not
  enough to make a root this workflow's. Treat it as the workflow's only when
  the thread already has a reply from Steve's account that ends with "This
  was sent from a bot", ignoring case, `*`, punctuation, and whitespace. The
  phrase may be on its own line or, in older replies, at the end of the
  sentence (`... this was sent from a bot.`). Or when the root is listed under "Claimed, not
  yet answered" in the automation's `memory.md`. Any other Steve 👀 means Steve
  has it: leave it alone. Of the workflow's roots, any without ✅ or 🎫, or
  with a human reply newer than our last reply, comes first in this run. A
  reply like "still broken" after a ✅ means the earlier fix failed. Find what
  that fix changed and why it didn't hold before trying again.
- **New reports:** roots from the last 5 days. React and reply on the root
  message's own `ts`. A channel-history row whose `thread_ts` differs from its
  `ts` is a reply that was also sent to the channel: use its `thread_ts`
  parent instead. Read the thread for every root
  that looks like a report. Open screenshots and attachments, since the error
  text in a screenshot is often the whole diagnosis.
- **Other sources.** Unread or failing sources are reported as
  **unavailable**, never as "nothing found".
  - GitHub: open issues updated in the window
    (`gh issue list --state open --search "updated:>=<date>"`). Skip ones
    someone else has offered to fix.
  - Sentry (frontend and backend projects) and Agent-Native Analytics
    (`list-error-issues`, then `get-error-issue`): unresolved, recent, and
    repo-owned.

## 2. Triage: lean toward fixing

Put each report in one bucket:

- **Fix:** anything objectively broken. This means errors, nothing happening
  on click, lost or wrong data, regressions, slowness, jank, and visible
  defects like clipped or overlapping text, unreadable contrast, or a broken
  layout. A credible "nothing happens" counts as evidence.
- **Build:** a feature request or UX change carrying Steve's `:upvote:` or
  `:yes-party:`.
- **Needs a person (🎫):** subjective product or UX changes Steve hasn't
  endorsed (add, move, hide, or restyle controls; "hard to find"), work that needs access or settings only
  a person has, a provider outage, or a report you can't act on without one
  missing fact.
- **Not actionable:** praise, chatter, announcements, things a human already
  answered, duplicates of something already in this run. These get no
  reaction and no reply.

Then add 👀 to every Fix, Build, and Needs-a-person root in one pass, before you
investigate. In an automation run, immediately list those roots (channel and
ts) under "Claimed, not yet answered" in its `memory.md`, and remove each one
once it has its reply. That list is how the next run tells an unfinished claim
apart from Steve's own 👀.

## 3. Fix as many as you can

- Group related reports so one cause gets one fix. Give each independent
  group a subagent on a cheaper model with disjoint files. The main thread
  plans, reviews diffs, and integrates.
- For each group, reproduce first where you reasonably can (a test, the
  action, or the flow in a local dev server), fix at the owning boundary
  (`fix-at-the-boundary`), and search for the same pattern elsewhere and fix
  those too.
- Verify the way `verifying-changes` describes: a test that fails before and
  passes after, or the reported flow working in the running app. Reading the
  code is not verification.
- Timebox one item to about 30 minutes. If it doesn't yield, it becomes 🎫
  with one line on what you learned and who should look.
- Never tune agent instructions or prompts around one report's wording.

## 4. Ship

Put every fix in one PR. Don't open one PR per item. In the PR body, add a
`Reports` section listing the Slack link of every report the PR fixes. That
list is the only set of threads a later `/ship` may close out as fixed.

Merge it the way this repo merges PRs. In a Factory workspace, that means
the workflow's merge step after its merge gate, never a direct merge.

A sweep's PR contains product fixes only. Don't edit this skill, add checker
scripts, or add bookkeeping files in it. If the run taught something, propose
a one-line lesson in the recap and Steve will decide whether it goes in.

## 5. Close the loop

This step is the only place a claimed report gets its closing reply. Run it
after the merge for the threads in the PR's `Reports` section. If the merge
happened outside this run, the next sweep runs it: when you collect, check
each open item's sweep PR, and close out the reports of any that have merged.
Run it once per thread: if a reply in the thread already links this PR, just make sure ✅ is
there and move on.

Write only as the connected Slack profile (Steve), only in the feedback
channels, and in the reply format from the contract above. Re-read each thread
before writing. If Steve has since added `:mag:` or a person has taken it over,
leave it. If a newer human reply says it's still broken, leave the 👀 for the
next sweep. Otherwise:

- **Merged fix:** add ✅ and reply that it's fixed, with the PR linked, and
  will be on beta shortly.
- **Fix ready but not merged yet** (for example CI is still running when the
  run must end): reply that a fix (PR linked) is in review. Don't mention
  beta yet. The next run adds ✅ once it's merged, with no second reply.
- **Needs a person:** add 🎫 and say in plain words what's needed and who has
  it now, by name (Steve if no one else clearly owns it).
- **Couldn't reproduce:** add 🎫. If one small answer from the reporter would
  unblock it and you couldn't find it yourself, ask for just that. Otherwise
  say you couldn't reproduce it and that you've passed it to Steve. Never ask
  for anything already in the thread.

GitHub issues fixed by the merged PR get a one-line thank-you comment linking
the PR, and then get closed.

Before ending, re-read each thread you touched and check:

- every 👀 from this run has a reply after the latest human message, plus
  ✅, 🎫, or an open fix PR that lists it under `Reports`;
- every ✅ corresponds to a merged fix;
- no reply is technical or duplicated.

## 6. Recap

Keep the recap short and written for Steve:

```md
## Feedback sweep - <date, Pacific>
Fixed and merged (N): <one line each, with Slack thread link> · PR <link>
Needs a person (N): <what's needed, who>
Still open from earlier runs (N): <why>
Sources unavailable: <list or "none">
Lesson (optional): <one line>
```

If the run came from an automation, append the same recap to that
automation's `memory.md`.
