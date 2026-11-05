# Factory confidence and design signals

Every key judgment the factory makes carries a confidence score, so a person
sees the shaky calls instead of the factory acting on them silently. A
design, workflow, or UX question goes to the design group instead of being
guessed.

## Score a judgment

Start at 50, add the rows that apply, and clamp to 0-100. In `why`, name the
rows you used ("reproduced +20; Sentry matches +15; two causes open -20"), so
the same evidence always gets the same score.

| Evidence | Points |
|---|---|
| Reproduced the failure: a failing test, a stack trace, or the steps walked in a signed-in app | +20 |
| Production evidence for this reporter or symptom: Sentry, Analytics, logs, the read replica | +15 |
| `fix-proof` proven: red before the fix, green after, on the reported check (fix only) | +20 |
| The touched files are the surface the report names | +10 |
| One cause, with the rival explanations ruled out | +10 |
| Two or more plausible causes still open | -20 |
| Not reproduced: the call rests on reading code or the reporter's words alone | -15 |
| The change touches files outside the reported surface, or is bigger than the symptom | -10 |
| The answer depends on intent, UX, or taste rather than on evidence (also raise a design signal) | -20 |

For a join, score the match itself: +20 for the same error text, stack, or
page; -20 when the only overlap is the app. For a PR review, score how sure
you are the verdict holds against the review gates you checked.

## Who states which score

| Judgment | Stated by | Where |
|---|---|---|
| `triage` | The master | Each claimed report's upsert |
| `join` | The master | The report's upsert, before `factory-branch attach` |
| `root-cause`, `fix` | The fix branch | Its `CONFIDENCE` closing line, which the master records |
| `fix` | A babysit round | Its `CONFIDENCE` line, which the watcher records itself |
| `review` | The PR review worker | Its `CONFIDENCE` line, which the master records |

Record scores and design questions on the report. A new score replaces only
the same judgment's:

```bash
factory-state report upsert "<key>" --json '{"confidence":[{"judgment":"triage","score":80,"why":"reproduced +20; Sentry matches +15; one cause +10; not reproduced in prod -15"}]}'
```

## Below 70

The watcher flags every score under 70 on the Factory Console's Needs
attention view ("Low confidence") and pings the oncall group once in the
report's digest thread. What the factory does depends on the judgment:

- **`triage`, `root-cause`**: go ahead and record the score. A PR with an
  unconfirmed root cause still ships, as before.
- **`join`**: don't attach. Treat the report as its own fix group. A wrong
  join drops a report silently; a duplicate branch is settled later under
  "Duplicate and competing PRs".
- **`fix`**: the PR still opens and gets babysat, but the watcher won't merge
  it until a person approves it on GitHub. A later babysit round's score
  replaces the branch's, so a round that proves the fix lifts the hold.
- **`review`**: never approve. Record `needs-person` with the score in the
  note.

## Design signal

Raise one when the open question is how the product should behave, not
whether code is broken: which interaction a control should have, a flow
people find confusing, copy or layout, a draft and a revision that disagree,
or two reporters expecting different things. Examples are a debugger's
lifecycle, how edited dictation drafts reconcile with a revised transcript,
whether state persists across tabs, and agent activity that is hard to tell
apart from user messages.

Record it with `"design":{"question":"..."}`: one question a designer can
answer without reading code, with the options you see and the one you would
pick. Then:

- No PR: triage it `needs-person` as usual. In live mode, the 🎫 reply
  mentions `<!subteam^S0AD0JBLZST|@design>` instead of the oncall group.
- A fix branch that raises one still ships its smallest default as a PR, and
  the watcher holds the merge until a person approves it on GitHub.
- The watcher pings the design group once in the digest thread and lists the
  question on the Needs attention view as "Design input", owned by design.

Never raise a design signal for a code bug, a missing credential, or an
outage: those stay with oncall.
