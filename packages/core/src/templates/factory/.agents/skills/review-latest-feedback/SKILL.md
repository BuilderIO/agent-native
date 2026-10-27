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

Reactions can't be removed through the Slack connector, so never add one you
might need to take back. Every 👀 you add ends the run with ✅ or 🎫 and a
reply. A 👀 with no follow-up is the most common complaint about this workflow.

Every claimed report gets **one** reply in its thread per outcome:

- One sentence, plain words, warm but not gushing, written for a
  non-engineer.
- Say what happened and, for 🎫, what's needed and from whom (a plain name,
  never an @-mention).
- No PR numbers, commits, branches, file or function names, CI, "verified
  locally", "scope", or any mention of this workflow.
- End with exactly: `this was sent from a bot.`

Good:

- `thanks for flagging - this is fixed and will be on beta shortly. this was sent from a bot.`
- `thanks for flagging - the export now keeps your column order, and it'll be on beta shortly. this was sent from a bot.`
- `thanks - moving that button is a product call, so I've left it for Sid to decide. this was sent from a bot.`
- `thanks - I couldn't reproduce this; could you share the link to the deck where it happened? this was sent from a bot.`

Bad: anything that mentions a PR or SHA, lists "verified scopes", explains
reactions, says "Great catch!!", repeats the bug back, or posts a second reply
that adds nothing new.

## Boundaries

- **Slack:** only `#product-agent-native-feedback` (`C0ATH3CCZT4`),
  `#qa-agent-native` (`C0C4U4XRT6X`), and `#dev-agent-native-feedback`
  (`C0AJ5QV0J03`), or the narrower set the invocation names. Never react or
  reply anywhere else.
- **Leave a report alone** when:
  - Steve (`U0GCV21HC`) put `:mag:` on it;
  - someone in the thread asked a specific person to look, a teammate says
    they're handling it, or Steve asked for a human on it;
  - another person's 👀 sits on it and they've been active in the last 3
    days;
  - an earlier run's PR for it is still open. That PR's `/ship` closes the
    report out when it merges.
- **PRs:** push to, comment on, or merge only PRs authored by the active
  GitHub login (`gh api user --jq .login`). Never touch anyone else's PR unless
  the invocation names that exact PR and action.
- **Steve's `:upvote:` or `:yes-party:`** puts a feature request or UX change
  in scope: build the smallest version that does what was asked.
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
  root showing `eyes`, `white_check_mark`, `ticket`, or `mag`. Don't rely on
  `hasmy:` searches, which have returned nothing for roots that do carry
  Steve's marks.
- **Open items first.** Every run posts as Steve, so any 👀 from Steve's
  account is this workflow's, whichever earlier run added it. A root with
  Steve's 👀 and no ✅ or 🎫, or with a human reply newer than our last reply,
  comes first in this run. A reply like "still broken" after a ✅ means the
  earlier fix failed. Find what that fix changed and why it didn't hold before
  trying again.
- **New reports:** roots from the last 5 days. Read the thread for every root
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
investigate.

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

Put every fix in one PR and run `/ship` through the merge. Don't open one PR
per item.

A sweep's PR contains product fixes only. Don't edit this skill, add checker
scripts, or add bookkeeping files in it. If the run taught something, propose
a one-line lesson in the recap and Steve will decide whether it goes in.

## 5. Close the loop

After the merge (or at the end of the run if it can't merge), for every root
you put 👀 on:

- **Merged fix:** add ✅ and reply that it's fixed and will be on beta shortly.
- **Fix ready but not merged yet** (for example CI is still running when the
  run must end): reply that a fix is ready and will be on beta soon. The next
  run adds ✅ once it's merged, with no second reply.
- **Needs a person:** add 🎫 and reply with what's needed and from whom.
- **Couldn't reproduce:** add 🎫 and ask one specific question that would
  unblock it. Don't ask for anything already in the thread.

GitHub issues fixed by the merged PR get a one-line thank-you comment linking
the PR, and then get closed.

Before ending, re-read each thread you touched and check:

- every 👀 from this run has ✅ or 🎫 and a reply after the latest human
  message;
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
