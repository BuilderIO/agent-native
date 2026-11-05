# Legacy watcher messages

The old factory runner (sweeps and a long-lived master run) is still live
until the factory VM reloads with the event-driven runner. Its messages carry
no `"resultsAsItems": true`, and their `type` is `sweep`, `events`,
`pr-batch`, `worker-report`, or `continue`. Delete this file once the factory
VM runs the event-driven runner.

For such a message, follow `SKILL.md` with these sections in place of its
own. Where `SKILL.md` says a result "comes back as a `worker` item", read
"arrives as a `worker-report` message that wakes you". There is no
`factory-state item done` and no `factory-branch attach --note`.

## 1. Read the message

- `sweep`: run `review-latest-feedback`'s collect step: the Slack feedback
  channels, GitHub issues, CI on main, Sentry (org `$SENTRY_ORG`, only the
  project ids in `$SENTRY_PROJECTS`, since the org holds unrelated products),
  Analytics errors, chat-run health (`node scripts/chat-health.mjs --hours 72`),
  deploys, and the alert channels (see Alerts). Use its 5-day window, unless
  the message has `windowStart`: then collect only reports created or updated
  since then. Always run Refactor findings, including the catch-up below;
  only when `$FACTORY_PR_REVIEW` is `on`, also run Pull requests and
  Community issues below. Also handle the message's `events`.
- `events`: handle only the listed items. Read each Slack thread in full. An
  event whose `channel` is in `$FACTORY_SLACK_ALERT_CHANNELS` is an alert (see
  Alerts); `kind` `mention` is someone asking the factory directly (see
  Mentions); `kind` `pr` is a human PR with new activity (see Pull requests
  below). A GitHub `issue` event for an open issue labeled
  `refactor-findings` is a refactor work order (see Refactor findings); a
  closed one is never work.
- `pr-batch`: a rehearsal of PR review on `limit` PRs (see PR batch).
- `worker-report`: a fix branch stopped; go to step 5.
- `continue`: read `reason`, check `factory-state show`, and carry on.

## 3. Share what's new, for a running branch

When `attach` printed `running: true`: note it on the report and wait. When
the branch's `worker-report` arrives, send it with `factory-branch message`
if the result doesn't already cover it. Never message a branch that is still
running.

## 4. After starting branches

End your turn: each branch's `worker-report` wakes you. Claim reports with
👀 when you record them; you answer them when the result arrives in this run.

## 5. Record each result

A `worker-report` message carries the same fields as a `worker` item
(`branchName`, `url`, `reports`, `outcome`, `gitBranch`, `prUrl`, `text`).
Handle it with `SKILL.md`'s step 5, without `followUps` and without
`factory-state item done`.

## In every live sweep

- **After a merge**, with `$FACTORY_BABYSIT` `off`: check each report's
  `prUrl` with `gh pr view <prUrl> --json state,mergedAt` and close out
  merged ones as `SKILL.md` says. A closed, unmerged PR goes under "Needs a
  person" in the recap, unless the factory closed it under "Duplicate and
  competing PRs".
- **Duplicates**: check each open factory PR against merged and open PRs for
  the same problem, with the "Duplicate and competing PRs" rules.

## Pull requests

**Which PRs.** A `pr` event, or in a sweep every open PR updated in the window
that isn't a draft, a bot's, or the factory's own
(`gh pr list --state open --json number,author,isDraft,updatedAt`). Skip one
with no human commit, review, or comment since its report's `updatedAt`, and
member PRs under "One approval per PR". Record each before acting, keyed by
its URL, `source` `github`, title "PR #<n> <app>: <title>". Classify each with
`SKILL.md`'s "Who wrote it" (`factory-github membership <login>` and
`gh pr view <n> --json isCrossRepository,assignees`).

**Review in workers.** A full diff review doesn't fit in your context for more
than a PR or two, so classify each PR yourself, then give each one needing a
review its own local session (reserve it like any spawn):
`builder sessions spawn --prompt-file tmp/factory/<slug>.md --parent <your session id> --name "<name>" --json`.
Your session id is `run.masterSessionId` in `factory-state show`. The prompt:

```text
Review <PR url> for the agent-native factory, as <member | outside contributor | member fork> <login>, in <live | dry> mode.
Read and follow .agents/skills/factory-run/references/pr-review.md.
```

The worker records its own outcome on the PR's report. Check it against its
closing lines (`triage`, `note` from WHY, `wouldReply` from REPLY, its
`review` score from CONFIDENCE) and fix the record if they differ. Leave PRs
out of the recap.

## PR batch

A `pr-batch` run rehearses PR review for a person to judge. Nothing reaches
GitHub or Slack: no approvals, comments, reactions, digest, or recap.

1. Pick `limit` PRs as "Which PRs" says, most recently updated first,
   including fork PRs when there are any. Record each. If membership is
   `unknown`, use `gh pr view --json authorAssociation` (`MEMBER`/`OWNER` vs
   anything else) as a stand-in and mark the PR "membership unverified".
2. Spawn one review worker per PR with the prompt above in `dry` mode,
   whatever the machine's mode, adding the line "REHEARSAL: post nothing to
   GitHub; report what you would do." Its `approved <sha>` then means "would
   approve". `factory-github approve` refuses during a `pr-batch` run anyway.
3. Write the evidence to `$FACTORY_HOME/pr-batch/<runId>.md`: per PR its link,
   author, member or outside (and how you verified it), head reviewed,
   outcome, each gate and what it found, the verbatim reply it would post, and
   the WHY. Then counts by outcome, what the factory couldn't do, and where it
   disagreed with what a person already did.
4. `factory-state run finish --summary "pr-batch: <counts>; evidence in pr-batch/<runId>.md"`.

## Refactor findings catch-up

In a sweep, also list refactor work orders with
`gh issue list --state open --limit 500 --label refactor-findings --json number,url,title,author,updatedAt`
to catch any an event missed, and handle them with `SKILL.md`'s Refactor
findings rules. Refactor issues go in the recap's "In review" or "Needs a
person" like any report.

## Community issues

In a sweep with `$FACTORY_PR_REVIEW` on, also find open issues from people
outside BuilderIO with no reply yet from a member or the bot
(`gh issue list --state open --limit 500 --search "sort:created-asc -label:refactor-findings" --json number,author,comments,createdAt`, then
`factory-github membership`). Handle the oldest 10 per sweep as GitHub issue
reports through normal triage.

## 6. Sweeps only: post the recap

A source you can't read is "unavailable" in the recap, never "nothing
found", with the secret behind it named.

In dry mode, for every report in the window that another run reacted to or
replied on, upsert `liveFactory` (`reactions`, `replyPermalink`, `prUrl`) and
add a comparison table (their outcome vs yours) after the recap.

The digest renders markdown as Slack blocks, so write
`review-latest-feedback`'s recap for scanning, to
`tmp/factory/recap-<runId>.md`, then `factory-digest post --file …`, which
posts it in today's factory log thread:

```markdown
# Feedback sweep · 2026-10-30 (live)

Fixed 2 · needs a person 1 · not picked 12 · sources unavailable: Sentry

## In review

- [Slides audit-contrast crashes outside the editor](<slack permalink>) · [PR #8501](url)

## Needs a person

<!subteam^S0C43BD9CMT|@agentnative-oncall>

- [GitHub issue #8360 Clips recordings over 24 MB](<issue url>): one line on why

## Needs design input

<!subteam^S0AD0JBLZST|@design>

- [Chat: agent activity is hard to distinguish](<slack permalink>): the question

## Not picked

- [Short title](link): reason
```

Include each section, with its mention, only when it has an item. Design
questions go under "Needs design input", not "Needs a person". Say `(dry run)` or `(live)` in the heading; in dry mode the first section is
"Fixed on a branch" with Builder branch links. For an `events` run, start with
`## Triggered by`: one bullet per event, linked to what started it. Every
report gets its own one-line bullet linked to its permalink or issue URL.

## 7. Finish the run

When every claimed report except a PR has a digest card, every 👀 you added
in live mode has its reply, and none of your workers is still running (no
branch without a `worker-report` in `factory-branch list`, no session in
`builder sessions ls --json`):

```bash
factory-state run finish --summary "<one line: fixed N, PRs N, joined N, needs a person N, unavailable sources>"
```

If workers are still running, end your turn instead of waiting; their reports
wake you.
