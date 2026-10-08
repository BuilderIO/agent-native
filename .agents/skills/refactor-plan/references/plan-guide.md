# Writing a plan

`new-plan.ts` scaffolds the file with frontmatter and the measured evidence.
You fill the reasoning. `jira-upsert.ts` refuses to file a plan that still
has `TODO(agent)` markers, or a confidence that isn't `high`, `medium`, or
`low`.

The plan is attached to a Jira ticket, and the engineer reading it may not
know this repo. Write so they can start work from it alone.

## Frontmatter

- `summary`: two sentences, used as the ticket description. Say what keeps
  breaking and what change stops it.
- `title`: an imperative, specific line, for example "Give Slides one
  live-resource lifecycle hook". The ticket summary becomes
  `[<area>] Refactor: <title>`.
- `area`: matches the existing ticket prefixes: `Framework`, `Slides`,
  `Design`, `Clips`, `Content`, `Dispatch`, `General`.
- `systems` and `paths`: trim them to what the change really touches. Dedup
  matching uses them.
- Do not edit `fingerprint`, `runId`, or `jira` by hand.

## Sections

- **Verdict**: fragile or fast-moving, and why, citing PR numbers. Include
  one sentence on what evidence would retract it.
- **Evidence**: keep the generated block. Add what the diffs showed: the
  repeated mechanism, with two or more PR references.
- **Root problem**: the boundary that forces local patches. One paragraph.
- **Proposed change**: the new contract, what owns it, and what gets
  deleted. Keep merge or domain logic separate from lifecycle and plumbing
  unless the diffs show they are the same bug.
- **Likely affected files**: the trimmed list.
- **Migration**: numbered, incremental steps that can ship one at a time.
  Prefer strangler moves: build the shared piece, move one consumer,
  delete the old code.
- **Risks**: what breaks, how you would notice, and how to roll back. Call
  out repo constraints that apply:
  - a `.changeset` for publishable packages;
  - all locales updated for copy changes;
  - additive-only schema;
  - the Design parity bar.
- **Order of operations**: dependencies on other plans in the run, and any
  read-only spike to do first.

## Style

Plain sentences, no marketing tone, no em dashes. Numbers come from the
run. If a figure is inferred rather than measured, say so.
