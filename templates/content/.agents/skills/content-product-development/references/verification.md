# Content product verification

Choose proof in proportion to the affected contract. Deterministic tests prove
data and Action semantics; real-interface testing proves that the workflow is
actually usable.

## Cross-surface matrix

Verify the applicable rows:

| Surface           | Proof question                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| UI                | Can a person complete the Feature's example workflow through the real interface?                           |
| Actions           | Can an agent perform the same authorized operations without a second mutation path?                        |
| Application state | Does the agent receive the focused object, View, selection, and temporary filters the person sees?         |
| Access            | Do reads, writes, direct links, derived results, public output, and embeds preserve authority?             |
| Persistence       | Does the result survive reload, retry, interruption, and process boundaries appropriate to the Capability? |
| History           | Does the record name the actual human, agent, automation, or integration actor and remain recoverable?     |
| Sources           | Does identity survive refresh and write-back without dropping unknown provider data?                       |
| Portability       | Does import, export, or static rendering preserve the accepted meaning or report explicit degradation?     |
| Accessibility     | Do keyboard and assistive-technology paths support the primary workflow?                                   |
| Performance       | Does the workflow stay inside its declared scale, time, memory, and output limits?                         |

### Editor-ready budget (D4)

A lane that touches Content startup compares itself with main before calling
its PR ready. Serve main and the lane's build on two ports against the same
fixture account, then run from `templates/content`:
`node scripts/trace-startup.mjs --compare --main-url <main> --lane-url <lane>`.
The defaults are the budget: cached `/home` at 1280x800, four alternating blocks
of seven runs, metric `content-editable:painted`. The lane passes when its p50
is at most main's p50 plus the gap between main's two block p50s. Paste the
final `D4 PASS` or `D4 FAIL` line into the PR. A fail is a finding, not a run to
repeat until it passes; `D4 UNMEASURED` proves nothing, and a run with
overridden defaults says `(not a D4 run)`.

### Stored-form acceptance (SF-01 to SF-12)

The browser and MCP checks live in `e2e/stored-form/`; the writer checks are
`acceptance/*.db.test.ts`. CI runs both on each side of the live-body gate, and
checks tagged known-loss run in steps that report without failing the PR. A
lane's fix drops the tag from every check it flips, in the same PR, so the
check blocks every PR after it. A check main fails differently on each side of
the gate takes `knownLossOnArm` from `e2e/live-body-gate.ts`; a fix that flips
one arm deletes only that arm's entry. Run the browser checks against the production
build, which refuses PGlite: serve `.output/server/index.mjs` on Postgres, then
from `templates/content` run
`CONTENT_BASE_URL=<url> CONTENT_LIVE_BODY_GATE=off npx playwright test -c e2e/playwright.config.ts e2e/stored-form/`.
Global setup connects one MCP connector for the run, because the device flow
allows 20 starts a minute; two runs from one checkout at once overwrite each
other's connector. A change that means to alter what a writer stores with the
gate off reruns `acceptance/gate-off-stored-bytes.db.test.ts` with `-u` and
commits the golden diff.

## Status evidence

- `verified`: current proof covers the complete atomic contract.
- `failing`: current behavior contradicts the promise.
- `stale`: prior proof exists but no longer matches the implementation or
  environment.
- `in_progress`: implementation is actively being built or hardened.
- `approved_shape`: the contract is accepted but lacks implementation or proof.
- `exploring`: a material boundary remains unresolved.
- `deferred`: the contract is intentionally sequenced later.
- `superseded`: another record owns future work; follow `superseded_by`.

Never promote a generic Capability because one provider-specific donor works.
Never promote a Feature because several dependencies landed. The final proof is
the actual car, not a tasteful arrangement of engine parts on the garage floor.

## Updating the catalog

Change the atomic record first. Keep dependencies complete even when they are
already verified. Add public-safe evidence only: repository paths, tests, or
public documentation that proves the claim without private transcripts or
workspace links.

After editing records:

```sh
pnpm test:content-product-docs
pnpm guard:content-product-docs --write
pnpm guard:content-product-docs
```

Inspect the generated roadmap and encyclopedia diff. A regenerated projection
is not an editorial review; make sure the underlying record still says what a
new contributor needs to know.
