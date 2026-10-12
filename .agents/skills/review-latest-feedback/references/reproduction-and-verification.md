# Reproduction and verification

Use this reference for the detailed reproduction ledger and deeper verification
contract. The skill's general rule still applies to every objective defect.

## Bug-bash reproduction contract

For Design, Slides, Core/framework, and template bashes, the reachable reported
surface is the contract:

1. **Reproduce before editing.** Use the exact URL/route, app/template,
   account/workspace/role, build/package, browser/device, fixture, and inputs;
   record expected/actual, errors, and attached artifacts.
2. **Sweep siblings and boundaries.** Test a negative control plus empty, wrong,
   whitespace, case, and permission variants; enumerate every shared fingerprint.
3. **Repeat on the changed running artifact.** Rerun the flow, refresh/navigate,
   read UI and persisted state, and cover failure/retry/cancel/async paths.
   Destructive flows require wrong/partial/exact confirmation and recovery;
   do not delete unless needed.
4. **Test release/race layers when needed.** Use concurrency/10 runs, a clean
   scaffold, and the exact package for package reports. Reproduce and verify
   locally by default; use beta only if the full symptom cannot be reproduced
   locally and hosted behavior is needed. Record why. These checks support
   **Shipped**/**Live verified**, not a merged **Fixed** claim.
5. Record untested layers. Before merge, use an evidence-limited status. After
   verified source merge, mark **Fixed** even if release/live layers remain;
   routine rollout and optional beta checks aren't ticketed follow-ups.
   **Shipped**/**Live verified** need their own bars. Don't mark **Fixed**/`✅`
   without merged-source proof. Reopen repeats only with a fresh failing
   pre-change reproduction.

## Reproduction ledger

For each row, record symptom/surface, reproduction steps and account, expected
and pre/post behavior, tested commit/build, sibling results, untested layers,
and runtime layer (`local`, `source-only`, `built`, `deployed`, `observed-live`).

Without merged source proof, use an active or waiting disposition above. After
merge, **Fixed** may coexist with release follow-up; **Live verified** requires
all four bars. Status labels, reactions, and tests alone do not prove closure.
Repeats require a new pre-change failure and link the earlier false claim.

Regression claims require Red/Green proof: reverse-apply the hunk with
`git apply -R`, record failure, reapply, and record pass. Repeat timing checks
10x. If output is missing, build it and rerun on `origin/main` before calling
the behavior pre-existing.
