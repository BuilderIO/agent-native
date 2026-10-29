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

The detailed Slack reaction and reply rules are in
[slack-reaction-replies.md](references/slack-reaction-replies.md); read it before
marking, replying to, or closing any Slack report.

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

Every claimed report gets **one** reply in its thread per outcome. The one exception is
the merged `✅` close-out after an in-review reply, which gets no second reply. People
have pushed back on replies that were long, technical, condescending, vague
about who does what next, or that handed them work. Each reply must be:

- **An answer first:** if they asked something ("is this expected?"),
  answer it in the first words ("no, that's a bug"), not with a status.
- **Short:** one sentence, about 25 words at most, for someone who doesn't
  read code.
- **About what they'll notice:** say what changes for them ("recordings no
  longer get stuck on Saving"), not how it works ("cleanup now waits for the
  transcript"). Leave out file, function, and service names, PR numbers,
  ticket IDs, CI, logs, runs, "repro", "verified", "scope", "sweep", status
  labels ("In progress:", "Skipped:", "Resolved elsewhere:", "Blocked on
  human owner:", "Open - no question:"), and any mention of this workflow.
  Never report your own progress ("unreproduced", "not traced yet",
  "remains open"); say what happens next instead.
- **Clear on who does what next:** "I'll ..." or a named person ("Sid will
  decide ..."). Never "the team", "product", "the framework team", "the
  owner", or "someone". If no one else clearly owns it, say Steve will take
  a look (or decide). Replies post from Steve's account, so never "I've passed
  it to Steve". Never @-mention anyone.
- **Not a to-do list for them:** look things up yourself first (the
  message's time and author, their account and recent activity, logs, the
  linked page or screenshot). Ask only when nothing else can unblock it, and
  then ask one small thing, in this one reply. Never send a list of
  questions, never ask them to test, retry, re-record, pull, reinstall, or
  gather logs, and never come back later asking for something you could have
  asked the first time. If it needs access you don't have (credentials, admin
  rights, account changes), say Steve will handle it; never hand it to the
  reporter.
- **Plain, not preachy:** don't explain how the product works unless they
  asked, don't tell them what they should do, and skip apologies, hedging,
  "actually", "just", "simply", and "Great catch!!".
- **True:** "fixed" only for a merged fix, and "on beta shortly" only after
  the merge. Before that, the fix is "in review". Never "fixed and verified"
  on the strength of a local check.
- **Once:** never post the same reply twice, and never follow up with one
  that adds nothing new.
- Link the PR on the word "fix" (`<url|fix>`), never by number.
- End with the bold line `**This was sent from a bot**` on its own line,
  once.

Don't reply at all to jokes, venting, banter, a message meant for Steve
himself, or a thread a person is already handling. Once a person says they
have it, or asks the bot to stop, post nothing more in that thread. Before posting, reread the reply as the reporter: would they get it
in five seconds, know who does what next, and feel we did the legwork? Check
the draft before sending, not after: the first version is the one that
notifies them, so editing it afterwards doesn't undo it.

Good (each is the first line; the footer goes on the line below it):

- `thanks - the <https://github.com/BuilderIO/agent-native/pull/1234|fix> so the export keeps your column order is merged and will be on beta shortly.`
- `thanks - once this <https://github.com/BuilderIO/agent-native/pull/1234|fix> merges, the export will keep your column order; it's in review now.`
- `thanks - Steve will decide where that button should go.`
- `thanks - I couldn't find which deck this was; could you paste its link?`

So a full reply looks like:

```text
thanks - the <https://github.com/BuilderIO/agent-native/pull/1234|fix> so the export keeps your column order is merged and will be on beta shortly.
**This was sent from a bot**
```

Real replies that missed, and what to send instead:

| Sent | Instead |
| --- | --- |
| "Could you send the recording link, approximate time, and browser so we can trace whether the clip produced media before it tried to save?" | Find the recording from the reporter and message time first. If you still can't: "thanks - I couldn't find which recording this was; could you paste its link?" |
| "cleanup now waits for the transcript, and a fix is ready. It should be on beta shortly." (sent before the merge) | "thanks - recordings will keep their transcript once this <url\|fix> is merged; it's in review now." |
| "I've left moving it somewhere easier to find for product to decide." | "thanks - Steve will decide where the editor should live." |
| "Partially fixed - PR #7512 merged the project-instructions/context carryover fix", after she'd asked whether FullStory could be added for the whole org | Answer that question first: "yes - I'll add it for everyone" or "not yet - Steve will decide". |
| "All fixed and verified. Please try again!" plus instructions to pull main and reinstall | "thanks - this <url\|fix> is merged and will be on beta shortly." No homework. |
| More replies after Shawn wrote "bot please stop! I've got this all fixed and in flight" | Nothing. A person has it. |
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

Window: roots posted in the last 5 days (or since the timestamp or permalink
the invocation gives), for new reports and open items alike. An older thread
is in the window too when we have already replied in it and a person has
replied since the window began: a channel read only shows roots, so search for
recent thread replies (`in:<#channel> is:thread after:<date>`) to find them.
On 10/29 a teammate's vote and question sat unanswered under a 3-week-old
root. Other older threads are left as they are, except reports listed under
`Reports` in a sweep PR opened or merged in that window: those always get
their close-out.

Reading a source is a good job for a helper: give each source below its own
helper on the cheapest model (Luna in Codex, Haiku in Claude Code), ask for a
short list of candidates with links, and close it as soon as it reports. On
10/29 the three source reads cost $0.44 together; reusing those same helpers
for fixes afterwards cost $6.36, because each new job paid for its whole
growing history.

- **Read the channels.** Use `slack_read_channel` with
  `response_format: detailed` (paginate) back 5 days. Its output shows
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
  has it: leave it alone. Read the thread of every workflow root in the
  window, not just the channel row: a human reply newer than ours only shows
  there, and runs that skipped this left people waiting after our 🎫. A root
  listed in the `Reports` section of a sweep
  PR that is still open and that this run didn't open belongs to the run
  working on that PR: don't react
  or reply there, and leave it out of your self-check; just list it under
  "Still open from earlier runs". If that PR has had no push in 24 hours,
  its run has stopped: its reports are yours again. Of the remaining
  workflow roots, any
  without ✅ or 🎫, or with a human reply newer than our last reply, comes
  first in this run. A root with 🎫 and our reply after its latest human
  message is already answered: you may still fix it, but post nothing there
  until the fix merges. A
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
  - Sentry (through its connector, or the local reader the invocation
    names) and Agent-Native Analytics (`list-error-issues`, then
    `get-error-issue`): unresolved, recent, and repo-owned. Rank by users
    affected. An error with a stack trace is already a reproduction lead.
<!-- framework-repo-only:start -->
  - CI on main: `pnpm ci:red-report` (exit 2 means CI unavailable, not
    clean).
  - Chat run health: `node scripts/chat-health.mjs --hours 72`; see
    [chat-run-health.md](references/chat-run-health.md) for what each failure
    reason usually means.
  - Deploys and releases: `gh run list --branch main --status failure --limit 30`
    for the deploy, release, desktop, and publish workflows.
<!-- framework-repo-only:end -->

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
  missing fact. A bug you couldn't reproduce by reading code is still a Fix.
- **Not actionable:** praise, chatter, announcements, things a human already
  answered, duplicates of something already in this run. These get no
  reaction and no reply.

Issues from the error and health sources above go in the same buckets,
ranked with the Slack reports by people affected. They have no thread to react on,
so they appear only in the recap.

Take the Fix reports in order of how many people they hurt, and claim as
many as the run can finish. Any Fix, Build, or Needs-a-person root you leave
unclaimed gets no reaction, only one line in the recap saying why, so
nothing is dropped silently.

Then add 👀 to every root you claimed (Fix, Build, or Needs a person) in one
pass, before you investigate. In an automation run, immediately list those roots (channel and
ts) under "Claimed, not yet answered" in its `memory.md`, and remove each one
once it has its reply. That list is how the next run tells an unfinished claim
apart from Steve's own 👀.

## 3. Fix as many as you can

- Group related reports so one cause gets one fix. Give each independent
  group a fresh subagent on your own model and effort, with disjoint files,
  or fix it in the main thread. Never hand a finished helper a new job; start
  a fresh one. The main thread plans, reviews diffs, and integrates.
- **Reproduce before you edit.** Get the failure on screen first: a test
  that fails, the action returning the wrong thing, a stack trace, or the
  flow broken in a signed-in local app. Reading code is not an attempt:
  write the report's steps as a failing test, or walk them in the signed-in
  app. Only after a real attempt fails does a report become 🎫, and its
  recap line says what you ran. No reproduction means no code change;
  guessing at a fix is how one Clips popover got "fixed" four times.
- **Check the history.** `git log --since=30.days --oneline -- <files>`: if
  this surface was fixed before for the same symptom, that fix treated a
  symptom. Find the shared cause (`fix-at-the-boundary`) instead of adding
  one more patch, and look for the same pattern elsewhere.
- **Prove it.** The check has to fail with the fix's source changes put
  back to `main` and pass with them. A check that passes without your fix
  doesn't test the bug: write one that does. Tests that read source text
  never count. For a purely visual fix, before and after screenshots are
  evidence for a person to inspect, not automated proof. Before merging, a
  human must open both images and confirm they show the reported change. Put
  the evidence under the report in the PR's `Reports` section.
<!-- framework-repo-only:start -->
  Commit the fix and its check, then run
  `node scripts/fix-proof.ts --fix <that commit> -- <the check>` from the
  repo root and paste its `fix-proof: proven ...` line, unchanged, under
  each report it fixes (`visual: <before> <after>` for a purely visual
  fix). The required `Lint & format` check runs this gate for PRs with a
  `Reports` section and re-runs machine proofs. It marks visual-only reports
  as needing human validation before merge; the screenshot URLs do not count
  as proven. Write the check before you push. The second
  opinion below reads the red output to confirm the check failed on the
  bug, not on setup.
<!-- framework-repo-only:end -->
- **Two misses, then stop guessing.** If two attempts don't turn the check
  green, stop editing and capture the real failure first (stack, logs, the
  reporter's actual data). If that doesn't settle it within about 30
  minutes, it becomes 🎫 with one line on what you learned.
- **Second opinion before the PR, every time.** Give a fresh subagent on
  your own model only the report text, the diff, and the proof, and ask: does
  the check exercise what the reporter saw, is this the cause or a symptom,
  and what edge case breaks it? Fix what it finds before you open the PR. The
  10/29 run skipped this, and PR review found the edge cases one round at a
  time instead.
- **Keep fixes small.** Each report's fix goes in its own commit so a bad
  one can be reverted alone. A fix that grows past about 300 lines, or into
  a new subsystem (timeouts, cancellation, retries) the reporter didn't ask
  for, isn't a sweep fix: ship the small part and 🎫 the rest. Match the
  versions the workspace already pins; a sweep is not a dependency upgrade.
- Never tune agent instructions or prompts around one report's wording.

## 4. Ship

Put every fix in one PR, and open it once every claimed Fix report has a
fix or a failed attempt, so CI waits come after the fixing. Don't open one
PR per item. End the PR body with a
`## Reports` heading listing the link of every report the PR fixes: the
Slack thread, or the Sentry, Analytics, or GitHub issue. That list is the
only set of threads a later `/ship` may close out as fixed.

Wait for CI with one blocking command, such as
`gh pr checks <number> --watch --required --interval 60`, and don't post a
status line while it runs: every turn re-sends your whole context, and on
10/28 polling CI was half the main thread's cost.

Fix each review round's findings in one batch. If a second round still finds
a problem in the same fix, take that fix out of the PR, 🎫 its report with
what review found, and merge the rest. Close the PR only when nothing verified
is left in it.

Merge it the way this repo merges PRs. In a Factory workspace, that means
the workflow's merge step after its merge gate, never a direct merge.
<!-- framework-repo-only:start -->
In the framework repo, run `/ship` through the merge.
<!-- framework-repo-only:end -->

A sweep's PR contains product fixes only. Don't edit this skill, add checker
scripts, or add bookkeeping files in it. If the run taught something, propose
a one-line lesson in the recap and Steve will decide whether it goes in.

## 5. Close the loop

This step is the only place a claimed report gets its closing reply. Run it
after the merge for the threads in the PR's `Reports` section. If the merge
happened outside this run, the next sweep runs it: when you collect, list the
sweep PRs merged in the window (`gh pr list --state merged --limit 100 --search
"merged:>=<date>"`) and close out every report in their `Reports` sections
that still lacks its ✅, however old the report is.
Entries that aren't Slack threads get no Slack action: GitHub issues follow
the issue rule below, and Sentry and Analytics issues are only listed in the
recap.
<!-- framework-repo-only:start -->
In the framework repo, `/ship` step 6 runs this step after its merge, and
`address-feedback-with-replies` runs it for its own threads.
<!-- framework-repo-only:end -->
Run it once per thread: if a reply in the thread already links this PR, just make sure ✅ is
there and move on.

Write only as the connected Slack profile (Steve), only in the feedback
channels, and in the reply format from the contract above. First re-read
the contract and this step from fresh `origin/main` (`git fetch origin main
&& git show origin/main:.agents/skills/review-latest-feedback/SKILL.md`): a
run that started hours ago may be holding older rules. Re-read each thread before
writing. If Steve has since added `:mag:` or a person has taken it over,
leave it. If a newer human reply says it's still broken, leave the 👀 for the
next sweep. Otherwise:

- **Merged fix:** add ✅ and reply that it's fixed, with the PR linked, and
  will be on beta shortly. Only for reports whose `Reports` entry carries a
  proof (step 3). Without one, it's 🎫 and "Steve will take a look".
- **Fix ready but not merged yet** (for example CI is still running when the
  run must end): reply that a fix (PR linked) is in review. Don't mention
  beta yet. The next run adds ✅ once it's merged, with no second reply.
- **Needs a person:** add 🎫 and say in plain words what's needed and who has
  it now, by name ("Steve will take a look" if no one else clearly owns it).
- **Couldn't reproduce:** add 🎫. If one small answer from the reporter would
  unblock it and you couldn't find it yourself, ask for just that. Otherwise
  say you couldn't reproduce it and that Steve will take a look. Never ask
  for anything already in the thread.

GitHub issues fixed by the merged PR get a one-line thank-you comment linking
the PR, and then get closed. Post it even when someone else opened the issue,
or the PR already closed it: Steve wants reporters told, and this comment is
allowed under his "only message Steve" account rule.
<!-- framework-repo-only:start -->
CI, deploy, and chat-health failures you couldn't fix get one grouped message
per run in `#qa-agent-native`: one short line per workflow that is still
failing, linking only its latest failed run. Leave out runs that later passed
or were superseded. Never post one message per failure, and never open GitHub
issues for them.
<!-- framework-repo-only:end -->

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
Closed out from earlier runs (N): <Slack thread link> · PR <link>
Needs a person (N): <what's needed, who, what you tried>
Still open from earlier runs (N): <why>
Seen, not picked (N): <Slack thread link> - <one-line reason>
Sources unavailable: <list or "none">
Lesson (optional): <one line>
```

"Fixed and merged" is this run's PR only; reports you closed out for an
earlier run's merged PR go under "Closed out from earlier runs".

If the run came from an automation, append the same recap to that
automation's `memory.md`.
