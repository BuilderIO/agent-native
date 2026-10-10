---
name: investigate-bug
description: >-
  Given a bug report (GitHub issue, Jira ticket, file, or pasted text), find
  its root cause and decide per symptom whether it is a one-off or one instance
  of a pattern worth fixing at the root, then file or sight a deduplicated
  refactor ticket when it is. Use proactively whenever handed a bug report and
  asked what is wrong or whether something deeper is broken.
user-invocable: true
scope: dev
metadata:
  internal: true
---

# Investigate a bug

The question is not only "what broke". It's also "why did it break now",
and "will it keep breaking". This skill strings together:

- `bug-trace`: intake and root cause;
- `system-history`: what changed on the path;
- `refactor-plan`: the plan, when the cause is systemic;
- `jira-refactor-findings`: duplicate matching, sightings, and filing.

Run one investigation per report. Never change product code.

```bash
B=.agents/skills/bug-trace/scripts
H=.agents/skills/system-history/scripts
J=.agents/skills/jira-refactor-findings/scripts
P=.agents/skills/refactor-plan/scripts
S=.agents/skills/investigate-bug/scripts
```

## Steps

1. **Preflight**: `$H/doctor.ts` and `$J/doctor.ts`. Stop on any nonzero exit.
2. **Intake**: `$B/bug-intake.ts --issue <N|url> | --jira <KEY|url> | --file <path> | --text "<report>"`.
   It prints the run id; use it as `RUN` for the steps below.
3. **Split symptoms**, and give each a short label.
4. **Trace**: for each symptom, follow steps 1 and 2 of
   `.agents/skills/bug-trace/references/bug-investigation.md`. Write the hops
   with their runtime preconditions. Every file on the path is a focus file.
5. **History**: `$H/collect.ts --run $RUN --lookback-days 60 --no-prs`, then
   `$H/analyze.ts --run $RUN --focus <every path file> --label "<report title>" [--label-url <url>] [--keywords <words>]`.
   Re-run `analyze` as the trace grows.
6. **Dedup early**: `$J/jira-match.ts --run $RUN`. If an existing ticket's
   mechanism covers a symptom, record a sighting:
   `$J/jira-sighting.ts --run $RUN --key <KEY> --system <system> --source <report url or ref> --source-title "<title>" --note "<how this bug is an instance>" --apply`.
   That symptom's verdict is `known`.
7. **Investigate** each remaining symptom with steps 3 to 6 of the brief:
   - read every regression candidate, and find the trigger;
   - hold two or more explanations, and run the check that separates them;
   - reproduce in the branch browser when the path runs there;
   - check the framework rules and primitives;
   - look for sibling sites.

   When fanning out, give each sub-agent the symptom, its entry point, and
   the whole brief. Never give it a theory or a short list of files.
8. **Decide** each symptom using `references/bug-verdicts.md`. A
   recently broken feature needs a trigger first, then the pattern question.
9. **Plan if pattern**: `$P/new-plan.ts --run $RUN ...`. The scaffold adds a
   Trigger section from `bug.json`. Prefer a slug the nightly run would also
   choose, so both converge on one fingerprint. Then run
   `$J/jira-upsert.ts --plan <file>`, and add `--apply`. A plan backed only
   by `inferred` evidence is `low` and doesn't get filed.
10. **Record a verdict** for each symptom:
    `$S/bug-verdict.ts --run $RUN --symptom <label> --verdict one-off|pattern|known|needs-info --root-cause "<file:line, what goes wrong>" --reason "<why>" --evidence reproduced|traced|inferred`, plus:
    - one-off: `--fix "<local fix>"`;
    - pattern: `--plan <file>`, with `--unfiled "<why>"` if it has no
      ticket;
    - known: `--ticket KEY`;
    - needs-info: `--ask "<log, repro, or detail>"`, when code and history
      can't decide.

    One-off and pattern verdicts also need
    `--trigger "<commit and what it broke>"` and
    `--ruled-out "<rivals and the check>"`. Don't guess a verdict to finish
    the run.
11. **Summarize**: `$S/summarize.ts --run $RUN`. Exit 1 means no verdict yet.

## Report

Give the reporter, for each symptom:

- the verdict;
- the root cause, with file:line and the evidence level;
- the trigger;
- the local fix, the ticket link, or what you need from them.

Lead with what they need to act on.
