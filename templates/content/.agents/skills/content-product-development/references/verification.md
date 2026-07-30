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
