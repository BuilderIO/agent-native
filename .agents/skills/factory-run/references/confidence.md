# Factory confidence and design signals

Every key judgment the factory makes carries a confidence score, so a person
sees the shaky calls instead of the factory acting on them silently. A
design, workflow, or UX question goes to the design group instead of being
guessed.

## Score a judgment

Start at 50, add the rows that apply, and clamp to 0-100. In `why`, name the
rows you used ("reproduced live +20; Sentry matches +10; two causes open -20"), so
the same evidence always gets the same score.

| Evidence                                                                                                                              | Points |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Reproduced live: the reported symptom seen in a running app, a browser or e2e run, or by replaying this report's production data      | +20    |
| Test reproduces hypothesis: a failing unit test encodes your own guess at the cause (instead of the live row)                         | +5     |
| Production evidence for this reporter or symptom: Sentry, Analytics, logs, the read replica                                           | +10    |
| `fix-proof` proven: red before the fix, green after, on the reported check (fix only)                                                 | +15    |
| The touched files are the surface the report names                                                                                    | +5     |
| One cause, with the rival explanations ruled out                                                                                      | +10    |
| Two or more plausible causes still open                                                                                               | -20    |
| Not reproduced: no live repro and no failing test; the call rests on code, logs, or the reporter's words                              | -15    |
| The change touches files outside the reported surface, or is bigger than the symptom                                                  | -10    |
| Behavior or contract change for existing callers (output shape, API, auth or session semantics), unless the PR names and updates them | -15    |
| Body/diff mismatch: the PR body or root cause claims code the diff lacks, or the diff changes what the body never mentions            | -30    |
| The answer depends on intent, UX, or taste rather than on evidence (also raise a design signal)                                       | -20    |

Red required CI caps a `fix` or `review` score at 60 until it's green.

For a join, score the match itself: +20 for the same error text, stack, or
page; -20 when the only overlap is the app. For a PR review, score how sure
you are the verdict holds against the review gates you checked.

Calibration:

- A unit-test-only fix, proven, on the reported surface: 50 +5 +15 +5 = 75.
  Add production evidence and ruled-out rivals for 95. Only a live repro
  reaches 100.
- #8581: the same, but it changes a JSON output shape callers parse: 75 -15
  = 60, held.
- #8584: the body claims a `production-agent.ts` change; the diff is a spec
  and a changeset: 75 -30 = 45, held. #8717, with red CI, caps at 60.

## Who states which score

| Judgment            | Stated by            | Where                                                     |
| ------------------- | -------------------- | --------------------------------------------------------- |
| `triage`            | The triage run       | Each claimed report's upsert                              |
| `join`              | The triage run       | The report's upsert, before `factory-branch attach`       |
| `root-cause`, `fix` | The fix branch       | Its `CONFIDENCE` closing line, which a triage run records |
| `fix`               | A babysit round      | Its `CONFIDENCE` line, which the watcher records itself   |
| `review`            | The PR review worker | Its own report upsert, matching its `CONFIDENCE` line     |

Record scores and design questions on the report. A new score replaces only
the same judgment's:

```bash
factory-state report upsert "<key>" --json '{"confidence":[{"judgment":"triage","score":80,"why":"test reproduces hypothesis +5; Sentry matches +10; surface +5; one cause +10"}]}'
```

## Below 70

The watcher flags every score under 70 on the Factory Console's Needs
attention view ("Low confidence") and adds a quiet line to the report's
digest thread. It mentions the oncall group only when the low score blocks a
person's action: a held fix merge, or a withheld review approval. Never add a
mention yourself. What the factory does depends on the judgment:

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
