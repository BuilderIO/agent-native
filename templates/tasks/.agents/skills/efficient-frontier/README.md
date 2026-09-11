# /efficient-frontier

Apply the same orchestration as `/efficient-fable` to any high-cost frontier
model.

`/efficient-frontier` is the model-agnostic version of `/efficient-fable`. It
works for any high-cost model where the expensive part should be reserved for
judgment, synthesis, integration, and final quality.

## What It Does

- Separates frontier-only decisions from delegable work.
- Pushes research scans, docs extraction, log reduction, browser checks,
  mechanical edits, and narrow coding tasks to cheaper agents.
- Asks delegated agents for compact evidence instead of broad essays.
- Uses self-contained handoff packets with scope, verification, and stop
  conditions.
- Treats delegated findings as leads that the frontier model verifies before
  relying on them.
- Keeps final integration and risk assessment with the frontier model.

## When To Use It

Use it for large or ambiguous work where independent slices can run in parallel:
repo exploration, refactors, multi-file implementation, test-failure clustering,
or PR-quality validation.

Skip it when the work is tiny, when edits are all in the same fragile files, or
when the next step depends on one immediate blocker you need to inspect yourself.

## Testing Guidance

The frontier model should choose the validation plan. Cheaper agents can run
unit checks, browser flows, screenshots, and log reduction, then return exact
commands, failures, likely causes, and the signal quality.

## Delegation Quality

Give each delegated agent enough context to succeed without the full chat:
objective, repo path, in-scope files, out-of-scope areas, expected evidence,
verification commands, and stop conditions.

The frontier model should reopen important cited files, review high-risk diffs,
and spot-check verification before presenting the final answer.

## Install

```sh
npx @agent-native/skills@latest add --skill efficient-frontier --update-instructions
```

Use `--update-instructions` when you want the orchestration convention added to
project instructions.
