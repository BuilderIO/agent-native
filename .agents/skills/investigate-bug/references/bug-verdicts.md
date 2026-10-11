# Bug verdicts: one-off or pattern

Answer two questions, in this order:

1. **Why did it break now?** The trigger is the broken hop and the change
   that broke it. A plan that fixes a real weakness but not the trigger leaves
   the user's bug in place. Lead with the trigger, then the pattern.
2. **Will it keep breaking?** That is the pattern question below.

A defect can be real and still not be the cause. If you find one, for
example a race, check it against the symptom before naming it the root
cause. An always-present race rarely explains a report that something
recently stopped working.

The reported bug is one instance. A pattern needs at least one more,
from history or from the code as it stands today.

Call it a **pattern** when any of these hold, and you can name the mechanism:

- An earlier fix in the lookback addressed the same mechanism on the focus
  files, or the same mechanism in a sibling template. The bug is a
  regression or a repeat.
- The faulty construct exists at other call sites today, so the same bug
  is latent elsewhere. Cite file:line for at least one.
- The defect comes from a contract that invites it: a failure coerced into
  a clean value, a template's copy of a core primitive, or an implicit state
  machine. See the fragility signs in the refactor-plan rubric.
- The focus system scores `likely-fragile` and the diffs agree.
- The code bypasses a framework rule or primitive, for example a
  hand-rolled background runner where AGENTS.md requires the core run
  manager. These are high-confidence, because the fix is known.
- A hop depends on a precondition that only holds in some UI or runtime
  state, such as a panel that is mounted only while one tab is selected.

Call it a **one-off** when the defect is local: a wrong condition, a typo, a
missing case specific to one feature, an environment or config slip. No
earlier fix of the same kind, no sibling sites. A one-off still gets a root
cause and a suggested fix, so the report is answered.

Evidence limits confidence. A bug-triggered plan whose evidence is only
`inferred` (no broken hop shown, no trigger found) is `low` at most.
Record it, and don't file a ticket until a trace or a reproduction
confirms it.

When two or more causes fit and only the reporter's environment can tell
them apart (a log line, an OS version, a setting), the verdict is
`needs-info`. Name the evidence that decides it and what each answer means.

One report can hold both: several symptoms with different verdicts. A
symptom whose cause is a recent feature still settling is usually a one-off.
Say so, because the nightly run will catch it if the fixes keep coming.

The fragility signs these refer to (repeated mechanisms, parallel
implementations, failures coerced into clean values, implicit state
machines) are in `.agents/skills/refactor-plan/references/rubric.md`.
