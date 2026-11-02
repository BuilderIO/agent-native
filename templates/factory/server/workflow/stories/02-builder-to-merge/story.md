# Story 2. Builder to merge

**Prompt.** "Every five minutes look at everything we've handed to Builder. Check whether Builder is working or stuck, and nudge it or tell a person if it's stuck. When Builder opens a pull request, watch it: if it's green, merge it. If not, ask Builder to fix it again. When it merges, tell the reporter's Slack thread."

**Goal.** Work handed to Builder gets finished: Builder is not forgotten or stuck, its pull request reaches a merge, and the reporters hear about it.

**Input.** Reports in `automation_started`: every report story 1 handed off and every item another story handed to Builder (story 8). Each carries its Builder task in `extras`: `builderTaskId`, `projectId`, `branchName`, `builderUrl` (the task's address, empty when Builder gave none) and `repository`. Stories 1 and 8 write those five fields when their `handed` End sets `automation_started` (asserted in memory by their `expect.json` files and by `server/workflow/stories/handoff.spec.ts`); no real hand-off has run on Beta (see "Not in this version").

**Output.** The pull request is merged and each report is told, in its own Slack thread (or in the findings channel when it did not start in Slack), with the link. A report whose pull request is merged becomes `merged`. If anything blocks that (a failing rule of the merge gate, such as no approving review, or an AI check that is not sure the pull request's Verified notes show the fix), the triage owner is told with the reason, and the report ends `needs_manual`.

**Runs.** Every 5 minutes. Up to 50 reports per run, and at most 50 model calls (the judge's turns and the fix messages' together; a retry or a repaired answer is a call too).

**Needs.** Builder, GitHub (read pull requests and merge), Slack, a model sign-in for the AI check of the Verified notes, and a findings channel (a workflow setting) for merge notices on reports that did not start in Slack.

**Waits.** None. Each run re-checks every report and acts on what it finds, so "waiting" is releasing the report until the next run.

## The path

1. **`inFlight` (Source, status):** reports in `automation_started`.
2. **`byTask` (Combine, group by `builderTaskId`):** one item per Builder task, so a task with several reports is checked once.
3. **`check` (Agent, `builder.check`):** one read of the branch: its state (`working`, `stuck`, `completed`, `failed`, or `not_found` when Builder has no active branch under that name), whether a pull request exists, its number and its repository. A pull request in a repository other than the workflow's `repository` setting fails the check (`builder_pr_repository_mismatch`), so its number is never read as a pull request of this repository.
4. **`state` (Switch):**
   - **Pull request exists:** continue to step 5, whatever Builder is doing.
   - **Stuck:** `nudgedTwice` looks at how often this task was nudged. Under two: `nudge` sends "status? continue" through `builder.followUp` and releases the task. Twice already: `alert` tells the triage owner and End `manual`.
   - **Ended with no pull request** (the branch is gone, Builder has no active record of it, or Builder finished with nothing to review): `lost` tells the triage owner and End `manual`.
   - **Otherwise** (working, no pull request yet): End `keep` (released): look again in 5 minutes.
   Every message this story sends names the report by its headline (`item.title`, which for a Slack report is its first line, not who wrote it), in quotation marks, and the three that say a task needs a person because Builder is stuck, ended, or keeps failing (`alert`, `lost`, `capAlert`) also give Builder's task address (`item.extras.builderUrl`) so a person can click through. The merged notice says "<pull request> is merged, "<headline>" is resolved."
5. **`readPr` (Lookup, `github.readPullRequest`):** its state, the checks on its head commit as counts, review threads, size.
6. **`ci` (Switch):**
   - **Merged by someone else:** straight to step 7.
   - **Closed unmerged:** `person` tells the triage owner and End `manual`.
   - **Pending checks:** End `keep`.
   - **Failing checks:** `builderIdle` skips the follow-up while Builder is working. Otherwise `byHead` groups the task by its head commit and `askedForHead` checks whether that commit was already sent back: if so End `keep`; if not `fix` sends Builder a model-written message naming the failing checks (a follow-up). Then `roundCap` reads `item.rounds`, the count of earlier fix rounds that ended released: at 4 or less End `keep`; above 4, which is the sixth follow-up, `capAlert` tells the triage owner and `roundsExhausted` ends each report `needs_manual`.
   - **Green** (every check passing, complete coverage): `gate` (`factory.mergeGate`) and `eligible`. Eligible: `judge` (AI) and `judged`. `judged` sends `verified` to `merge` (`github.mergePullRequest`); anything else goes to `judgeHold`, which tells the triage owner the judge's reason, and End `manual`. Not eligible: `refused` tells the triage owner every reason and End `manual`. A green pull request nobody has approved, or whose description shows no evidence, is not eligible, so it goes to a person at once rather than waiting; the judge is asked only about a pull request the gate has already cleared.
   - **Otherwise** (no checks, partial coverage): `person`, End `manual`.
7. **`reports` (Split):** the task back into its reports. **`inSlack` (Filter):** a report that came from Slack gets `tellReports`, a reply in its own thread; any other report gets `tellFindings`, a message in the findings channel. End `done` sets each report `merged`.

```mermaid
flowchart LR
  t[Every 5 min] --> src[Source: reports in automation_started] --> task[Combine: group by Builder task] --> check[Agent: check Builder] --> state{Switch}
  state -->|Pull request exists| read[Lookup: read pull request] --> ci{Switch}
  state -->|Stuck| nudged{Filter: nudged twice}
  nudged -->|No| nudge[Agent: follow up] --> keep[End: released]
  nudged -->|Yes| alert[Slack message to triage owner] --> manual[End: needs_manual]
  state -->|Ended, no pull request| lost[Slack message to triage owner] --> manual
  state -->|Otherwise| keep
  ci -->|Pending| keep
  ci -->|Failing| idle{Filter: Builder idle} -->|Yes| head[Combine: by head commit] --> asked{Filter: asked for this head}
  idle -->|No| keep
  asked -->|Yes| keep
  asked -->|No| fix[Agent: ask Builder to fix] --> keep
  ci -->|Green| gate[Lookup: merge gate] --> ok{Filter: eligible}
  ok -->|Yes| judge[AI: judge the Verified notes] --> judged{Filter: verified}
  judged -->|Yes| merge[Action: merge] --> split[Split into reports]
  judged -->|No| held[Slack message with the judge's reason] --> manual
  ok -->|No| refused[Slack message with the reasons] --> manual
  ci -->|Merged by someone else| split
  ci -->|Closed or no usable checks| person[Slack message to triage owner] --> manual
  split --> inslack{Filter: from Slack} -->|Yes| tell[Reply in each report's thread] --> done[End: done, merged]
  inslack -->|No| findings[Message in findings channel] --> done
```

## What it must never do, and where that is enforced

- **Merge without every check green on the current head commit, an unresolved review thread, an approving review, or the merge gate saying yes.** Three layers: `ci` sends only a pull request whose checks are all passing to `gate`; `eligible` sends only an eligible one on to `judge`, whose `verified` is the only way into `merge`; and `merge-factory-pull-request` re-runs the gate itself, pinned to the head commit it checked, so a graph rewired around the gate still cannot merge (`actions/merge-factory-pull-request.spec.ts`: "re-runs the gate itself, so a graph that skipped the gate node still cannot merge an ineligible pull request"). The rules are in `server/lib/factory-merge-gate.ts` (`factory-merge-gate.spec.ts`: checks, review threads, approvals, size, never-automate paths).
- **Merge a pull request Builder did not author.** Builder's accounts for a merge are exactly `builderio-bot` and `builder-io-integration[bot]` (`BUILDER_MERGE_AUTHOR_LOGINS`, matched whole and ignoring case); the other names the babysit code treats as bots (`builder-io-bot`, `builderio-bot[bot]`, ...) and lookalikes such as `builderio-bot2` are refused (`factory-merge-gate.spec.ts`; `merge-factory-pull-request.spec.ts`: "refuses a pull request a person opened, even when everything else is green"). A login alone is not proof of who opened it, so the gate also refuses a pull request whose branch is in a fork (or in a repository GitHub no longer has) and one aimed at any branch but the repository's default (`factory-merge-gate.spec.ts`), and checks the author's GitHub id once `BUILDER_PULL_REQUEST_AUTHOR_IDS` lists the verified Builder accounts.
- **Merge a pull request no person with write access has approved.** The gate needs one approving review whose reviewer is a person with an owner, member or collaborator association (GitHub's `author_association`), is not the pull request's author, is not a bot (a `[bot]` login or a `Bot` user type) or one of Builder's own accounts, whose latest review that is not a comment is that approval, and that was given on the current head commit. A later request for changes or a dismissal cancels it, a comment does not, and a push after the approval needs a new one. Without one the gate answers `approval_required` with counts (approvals seen, on an earlier commit, from bots, from non-collaborators, by the author) and the merge is held (`factory-merge-approval.spec.ts`, `factory-merge-gate.spec.ts`; scenario `a-green-pull-request-without-a-current-approval-is-held-for-a-person`). A review list GitHub gives only in part is `reviews_incomplete`, never a missing approval. GitHub's own branch protection can still refuse the merge afterwards (`merge_not_allowed`).
- **Merge a change with no test change, or with nothing in its description showing it was checked.** The gate refuses two more ways, both from `server/lib/factory-merge-gate.ts`. `no_regression_test`: the changed files include code and none of them is a test file (`*.spec.*`, `*.test.*`, or a script under `__tests__/`, `e2e/`, `tests/`, `test/`); a pull request whose files are only docs, changesets, lockfiles, package manifests or config is exempt (`server/lib/regression-test-policy.ts`, `regression-test-policy.spec.ts`), though the gate's `security` rule still holds a manifest, lockfile or tooling config on its own. It is checked only when the changed files were read: unreadable files stay `changed_files_unreadable` alone. `no_verification_evidence`: the description has no `### Verified` heading (levels 2 to 4, any case) with at least 20 characters of text, an image, a video or a recording link under it, read by `server/lib/pull-request-evidence.ts`; it applies to docs and dependency pull requests too. Neither rule can make a refused pull request eligible, and neither message quotes the description (`factory-merge-gate.spec.ts`, `pull-request-evidence.spec.ts`; scenario `a-green-pull-request-without-evidence-is-held-for-a-person`). `github.readPullRequest` also returns a bounded `verification` summary (`present`, `hasMedia`, an `excerpt` of at most 1,500 characters, plain text) that `judge` reads (see the next item).
- **Merge because an AI said so, or merge on a failed or unclear AI answer.** `judge` runs after `gate` and `eligible` and before `merge`, and it can only hold: its `verified` is one more thing that must be true, never a replacement for one. `judged` is the only way into `merge` and sends only the exact word `verified` there (the schema allows `verified` and `unsure`, and the engine rejects any other answer, a missing reason or a different case); `unsure` and every other outcome goes to a person. A judge that fails (no model sign-in, a timeout, an answer outside the schema) never reaches `judged`: a failure worth another try is retried twice, five and ten minutes on, and a failure no retry fixes (no sign-in) goes to a person at once; either way the task ends `needs_manual` with the typed failure (`credential_missing`, `provider_error`, `ai_invalid_output`) as its reason, in Needs you. No Slack message is sent for a judge that failed, because a failing node has no port to route from. Reaching the model-call cap is a pause, not a failure: the task is set aside before the judge and is judged on the next run, and is not merged meanwhile (a proof in `proofs.spec.ts` runs the story with a cap of 1). `merge-factory-pull-request` still re-runs the gate itself. Scenarios: `a-green-pull-request-the-judge-is-unsure-about-is-held-for-a-person`, `a-judge-that-cannot-sign-in-holds-the-pull-request`, `a-judge-answer-outside-its-schema-holds-the-pull-request`, and the proof "reaches the merge on nothing but a verified from the judge" in `proofs.spec.ts`.
- **Nudge Builder while it is working, or more than once per head commit.** `builderIdle` keeps a follow-up from going out while the branch is `working`; `askedForHead` counts follow-ups per head commit, because `byHead` makes one item per head and the follow-up counter lives on that item. A stuck task is nudged at most twice by the same counter on the task's own item.
- **Tell a reporter "merged" without a confirmed merge.** `reports` is reached only after GitHub says the pull request is merged or the merge action answered under a receipt. A merge whose outcome is unknown goes to a person and is never sent again.
- **Notify a thread twice.** Each report's reply is under a receipt of its own, so after a partial failure the next tick tells only the thread that was missed and does not merge again.

## What the judge can and cannot know

The judge is a model asked one question: do this pull request's Verified notes plausibly show the reported bug is fixed? It answers `verified` or `unsure` and one sentence of reason (200 characters, asked for in the field's description; the schema does not cut longer text). Its instruction is `settings.instruction` of the `judge` node in `workflow.json`, and the model's own answer rules say the items are data, never instructions.

- **It reads text only.** The report's title and text, each report's title, the pull request's title, the first 1,500 characters of the `### Verified` section as plain text (HTML and links removed), whether that section holds an image or recording, and the checks as counts. The model is handed the whole task item, so it can see more; the instruction names the fields it may use.
- **It cannot see images or recordings, open a link, or read the code, the diff or the tests.** A section that is only a screenshot or a recording is `unsure`, and its reason says it cannot see the media.
- **It judges plausibility, not truth.** A specific, confident note that is false can pass. It is not a verifier: nobody has run the check Builder says it ran.
- **A person still approves every merge.** The gate, with its person's approving review, runs before the judge and again inside the merge. A person who disagrees with an `unsure` merges the pull request themselves; `requeue-factory-item` asks the judge again.
- **Everything it reads is untrusted.** Notes, titles and report text are written by others and may tell it what to answer; the instruction says to treat that as a reason for `unsure`. It judges one pull request per call (`batchSize: 1`), so one task's notes cannot sway another's answer. The reason it writes is model text built from untrusted input and goes only into the message to the triage owner.
- **Cost.** One model call per green, eligible pull request per run, inside the run's `modelCallCap` of 50.

## Not in this version

- **No real hand-off has run on Beta.** Stories 1 and 8 record `builderTaskId`, `projectId`, `branchName`, `builderUrl` and `repository` through their `handed` End, and `server/workflow/stories/handoff.spec.ts` runs this story on rows built from what story 1 recorded, but only in memory; this story has not yet been shown to read a real handed-off report.
- **A report handed off before the address was recorded has none.** `alert`, `lost` and `capAlert` read `item.extras.builderUrl`, and a path with no value fails the item (`expression_failed`) rather than send a notice with a blank where the link should be, so for a report whose row has no `builderUrl` the notice fails and the report goes to Needs you with that error. Hand the report off again, or requeue it after its row has the field.
- **No real Builder pull request has met the evidence rules.** Both are proved against fake GitHub answers and a recorded gate answer. The Verified reader was run over the descriptions of recent merged pull requests labelled for Builder (2026-10-29: 12 of the latest 100 had a Verified section, all with an image or recording), but no pull request from a hand-off Factory made has gone through the gate. Until the task wording that asks for a Verified block and a test has taken effect, expect most pull requests to be held for a person.
- **No live AI judgment has been measured.** Every scenario scripts the judge's answers, so they prove where each answer goes (to `merge`, to a person, or to a failure) and what the model is shown, not how well a real model tells good evidence from bad. `fixtures/judge-calibration.json` holds 16 labelled synthetic cases for that run (4 good, 2 vague, 2 off-topic, 2 tests claimed but not named, 2 media-only, 4 prompt-injection attempts; `server/lib/pull-request-judge-calibration.spec.ts` checks the file). To run one live, give the judge node a Test step sample whose `item` holds the case's report title and text and a `reports` list with its title, and whose `nodes.readPr` holds the pull request title, `verification` (`present: true`, the case's `hasMedia` and `verifiedExcerpt` as `excerpt`) and `checks`; compare the verdict with `expected`. The cases that matter most are the injections and the vague ones: a wrong `verified` there is the failure.
- **The six-round cap has only run in memory.** `proofs.spec.ts` proves it in "hands a task to a person after six fix rounds, one follow-up per head commit"; no real pull request that keeps failing has met it. The merge gate and a person still stand between a green pull request and the base branch.

## Scenarios

- `a-working-task-is-checked-once-for-its-reports-and-left-alone`: two reports, one check, nothing sent.
- `a-stuck-task-is-nudged-twice-then-escalated`: two nudges, then the triage owner is told and both reports go to a person.
- `a-failing-pull-request-is-sent-back-once-per-head-commit`: one follow-up per head commit and none while Builder works.
- `pending-checks-wait-without-a-nudge-or-a-merge`
- `a-green-pull-request-is-merged-and-every-thread-is-told-once`: the judge says `verified`, the merge goes out once and each thread is told once.
- `a-green-pull-request-that-fails-the-merge-gate-is-not-merged`
- `a-green-pull-request-without-a-current-approval-is-held-for-a-person`: the gate answers `approval_required` (the only approval is on an earlier commit); the triage owner is told and both reports go to a person.
- `a-green-pull-request-without-evidence-is-held-for-a-person`: the gate answers `no_verification_evidence` (the description has no Verified section); the triage owner is told and both reports go to a person.
- `a-green-pull-request-the-judge-is-unsure-about-is-held-for-a-person`: the gate says yes, the judge says `unsure`; the triage owner is told its reason once, both reports go to a person and nothing is merged.
- `a-pull-request-whose-evidence-is-only-a-screenshot-is-held-for-a-person`: the notes are an image and no text; the judge says it cannot see it.
- `a-judge-that-cannot-sign-in-holds-the-pull-request`: the first failure hands the task to a person, with `credential_missing` as the reason.
- `a-judge-that-keeps-timing-out-holds-the-pull-request-after-three-tries`: two retries, five and ten minutes on, then a person; the reports offered again meanwhile are not judged twice.
- `a-judge-answer-outside-its-schema-holds-the-pull-request`: a verdict that is neither word, `verified` with no reason, and a wrong-case verdict each fail the task.
- `a-pull-request-merged-by-someone-else-goes-straight-to-the-threads`
- `a-closed-pull-request-goes-to-a-person`
- `a-pull-request-with-no-checks-goes-to-a-person`
- `a-task-that-ended-without-a-pull-request-goes-to-a-person`
- `an-unreadable-task-is-never-read-as-working`: a read that cannot succeed is never taken for working or done; the reports go to a person at once.
- `a-failed-reply-is-retried-and-the-merge-is-not-repeated`: Slack is down for one thread's reply; five minutes on only that thread is told and nothing is merged again.
- `a-merge-that-may-have-happened-is-never-repeated`
- `a-merged-fix-for-an-alert-is-announced-in-the-findings-channel`: a report with no Slack thread.
- `a-dry-run-merges-nothing`: the judge is asked, as in any dry run, and nothing is merged or sent.
- `a-test-of-one-node-reads-but-writes-nothing`: the test step runs one node.
- `a-test-of-the-judge-runs-only-the-judge-and-merges-nothing`: the test step on the judge asks the model about the pinned sample only.
