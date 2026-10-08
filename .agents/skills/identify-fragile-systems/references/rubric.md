# Fragile or fast-moving

The triage score counts commits. It cannot see why a fix was needed. Read
the diffs and classify the system by what the fixes do.

## Signs of fragility (plan-worthy)

- **The same mechanism lands again.** A guard, retry, timeout bump, special
  case, or "hold until ready" branch is added to a different call site
  of the same abstraction. Two or more instances in the lookback is a
  finding.
- **A stacking conditional.** One function grows another special case in
  most fixes. AGENTS.md calls this "how the same bug ships twice".
- **Parallel implementations.** A template re-implements a core primitive,
  such as polling, upload status, access lifecycle, or model ids, and its
  fixes don't reach the others. The tell is the same bug fixed in two
  templates within the lookback.
- **Failures coerced into clean values.** A fix exists because a layer
  returned empty, default, or false for "unreadable" or "pending". This is
  the flagship AGENTS.md rule, and recurrences are high-confidence findings.
- **Implicit state machines.** Refs mirroring state, effects coordinating
  through tokens, and lifecycle flags. Each new combination of inputs
  produces a new fix.
- **Tests added per bug without a contract.** Every fix adds one regression
  test, but no shared invariant suite exists that adapters or templates
  must pass.

## Signs of fast motion (not plan-worthy yet)

- The fixes follow a feature that landed days earlier, on files it created,
  and taper off.
- The fixes are polish: copy, spacing, density, ordering, or follow-up
  review nits.
- One author is iterating on one PR series, each step building on the last.
- The commits are refactors or splits that move code without adding
  special cases. Expect a "settling" curve afterwards.

## Coupled is a separate verdict

A system that mostly changes as a side effect of other work, such as a
docs registry, a CI lane classifier, or a shared barrel, is not fragile
code. Plan it only if every feature _must_ hand-edit it and those edits
keep breaking, for example a lane that misses new paths. In that case the
fix is to generate or derive it.

## Bug reports: one-off or pattern

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
  machine. See the fragility signs above.
- The focus system scores `likely-fragile` and the diffs agree.

Call it a **one-off** when the defect is local: a wrong condition, a typo, a
missing case specific to one feature, an environment or config slip. No
earlier fix of the same kind, no sibling sites. A one-off still gets a root
cause and a suggested fix, so the report is answered.

When two or more causes fit and only the reporter's environment can tell
them apart (a log line, an OS version, a setting), the verdict is
`needs-info`. Name the evidence that decides it and what each answer means.

One report can hold both: several symptoms with different verdicts. A
symptom whose cause is a recent feature still settling is usually a one-off.
Say so, because the nightly run will catch it if the fixes keep coming.

## Confidence

- **High**: you read diffs showing the same mechanism two or more times and
  can point at the boundary to fix.
- **Medium**: the mechanism is clear, but the root-cause attribution or the
  fix shape is inferred.
- **Low**: the pattern is plausible but thin. Prefer a decisions.json note
  over a ticket.

Say what evidence would change the verdict. A nightly run will see the
system again, and the next sighting should be able to confirm or retract it.
