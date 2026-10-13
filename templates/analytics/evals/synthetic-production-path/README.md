# Synthetic production-path retrieval harness

This harness runs the shared Analytics production agent loop with the Analytics
production prompt, read-only action registry, final-response guard, explicit
synthetic caller identity, and usage capture. A deterministic in-memory engine
emits one `find-data` call and a safe metadata-only closeout; it does not call a
hosted model.

The fixtures use invented group and member entities, synthetic table and
column names, and an artificial test-member exclusion rule. They contain no
production model names, source definitions, production membership policy, or
identities. Catalog reads use fixture-backed Analytics dictionary, source-index,
and dashboard storage seams. Embedding discovery is disabled so the test cannot
read credentials or call an embedding provider. The action allowlist contains
only `find-data`; warehouse and connected-data actions are unavailable to the
loop.

## Historical v11 comparison (candidate snapshot `fb583843`)

This is the latest checked-in comparison, but it measures candidate commit
`fb583843666f597c9eced3d7f4f297fd5cdcec26`, not the current branch. Later
ranking and source-index changes are not covered by its 32/32 after score. Treat
v11 as historical evidence and do not use that score as a claim about current
branch quality until a fresh comparison is recorded. Its fixture supplies a
hard-coded synthetic source index and does not invoke `build-source-index.ts`.

The v11 comparison adds the case `negated-counts-preserve-role-detail` to cover
the review finding where a negated count request lost the following role
detail. It uses the same production path and synthetic fixtures as the earlier
v10 comparison, with sixteen cases run twice in each phase. The before phase is
pinned to `d0caebd20464a2a00ad417c78943d81438d9333a`; the after phase measures
the Analytics source changes at `fb583843666f597c9eced3d7f4f297fd5cdcec26`.

The evaluated code hashes are
`sha256:a31ae9051b291723b73c09752df3711dcea125df319de7b96483a52769def191`
before and
`sha256:2b0445b08a32d9afabc18ba1e429ee07898ad7033c4575d70e46ac6f184f9358`
after. Both phases use the candidate harness, whose hash is
`sha256:b9acd1d7c3c9758d57a4485fd56a72c7954ad2b3fefe74f128fc16fb1ca18472`.
The validator recomputes code and harness hashes from the pinned Git objects;
it does not accept a hash just because it has valid SHA-256 syntax.

Top-1 retrieval rose from 6/32 to 32/32 runs (18.75% to 100%). Hit@5 rose from
18/32 to 32/32 (56.25% to 100%). The added role-detail case moved from rank 4
before to rank 1 after. All 64 runs completed without aborts; each made one
`find-data` call and no other or failed action. These scores use the
deterministic synthetic engine, so they measure retrieval and production-path
integrity rather than hosted-model answer quality or production latency. The
v11 artifact is
`SYNTHETIC-analytics-production-path-v11-before-after.csv`.

To reproduce the v11 comparison, run the harness from candidate commit
`fb583843666f597c9eced3d7f4f297fd5cdcec26` twice: once against production
source files pinned to baseline commit
`d0caebd20464a2a00ad417c78943d81438d9333a`, and once with all evaluated source
files at the candidate commit. Set `ANALYTICS_EVAL_HARNESS_REVISION` to the
candidate commit for both runs and retain the emitted CSV only after verifying
that the before/after rows share the harness hash and fixture revision.

The v10 artifact and its original provenance remain unchanged for historical
comparison; the validator continues to check both versions against their own
pinned cases and commits.

## Historical v10 reproduction

The before phase is pinned to the exact `origin/main` snapshot
`d0caebd20464a2a00ad417c78943d81438d9333a`. The candidate source revision is
`595a07f9a507bba5ba43d6478969c6e19bea9ac2`, pinned in the comparison
validator. Both phases used the same `synthetic-analytics-retrieval-v10` fixture
and fifteen cases, twice each. The candidate SHA identifies the exact commit
whose production source files and harness were measured; the later artifact
commit adds the CSV, comparison assertions, and this README. It does not change
evaluated production source or harness files.

Before-phase checks verify all evaluated production source bytes against the
pinned baseline commit and require the copied harness to match the bytes at the
candidate commit named by `ANALYTICS_EVAL_HARNESS_REVISION`. The CSV records the
harness hash separately, and the validator requires it to be identical in both
phases. After-phase checks require a clean candidate source tree and every
evaluated file to match the supplied candidate commit. The evaluated code hashes
are `sha256:fb3f0bad8151998d81fcf994a55143ee58f64ed8c3483404237669514656a268`
before and
`sha256:9a1fc94f54d57e6656dc2793628bcccf917a416980fa1c861b7f44bd28f3d139`
after. The shared harness hash is
`sha256:5e746b9ffc64ce67cb7ee0b16a05b276ca6341bd26e90ba7bf12e26028df9ac9`.

The pinned baseline is newer than the PR's base, so this measures current main
against the candidate source commit rather than replaying the historical PR
base. The v9 artifact remains in the directory as historical evidence.

Re-run the already prepared baseline worktree at
`/tmp/analytics-eval-before-v10-d0caebd-595a07f9`:

```sh
ANALYTICS_EVAL_PHASE=before ANALYTICS_EVAL_GIT_REVISION=d0caebd20464a2a00ad417c78943d81438d9333a ANALYTICS_EVAL_HARNESS_REVISION=595a07f9a507bba5ba43d6478969c6e19bea9ac2 ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

Re-run the candidate in its clean worktree at
`/tmp/analytics-eval-after-v10-595a07f9`:

```sh
ANALYTICS_EVAL_PHASE=after ANALYTICS_EVAL_GIT_REVISION=595a07f9a507bba5ba43d6478969c6e19bea9ac2 ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The combined artifact is
`SYNTHETIC-analytics-production-path-v10-before-after.csv`. Its validator checks
the privacy-safe schema, all fifteen case IDs, exactly two runs per phase,
matching before/after `(case_id, run)` pairs, fixture, code, and shared harness
revisions, completion state, and the one-action allowlist. To verify the CSV and
the validator's mismatch tests, run:

```sh
pnpm --filter analytics exec vitest run evals/synthetic-production-path/comparison-validation.spec.ts
```

### Historical v10 results

Top-1 retrieval rose from 6/30 to 30/30 runs (20% to 100%). Hit@5 rose from
16/30 to 30/30 (53.3% to 100%). All 60 runs completed without aborts; each made
one `find-data` call and no other or failed action. Each phase recorded 7,200
input and 1,440 output tokens in the deterministic harness. Per-run latency is
local synthetic harness telemetry, not a hosted-model or production latency
claim.

The CSV serializer permits only synthetic case IDs and execution metadata:
phase, Git, code, and harness revisions, fixture revision, run number, coded
score and reason, expected rank and hit@5, action counts, completion and abort
state, aggregate token counts, and elapsed time. Prompts, model output, tool
inputs and results, SQL, identities, and fixture values are never serialized.
Scores measure retrieval and production-path integrity with a deterministic test
engine; they do not measure hosted-model answer quality or reproduce historical
user chats.

The synthetic retrieval-only benchmark is recorded separately in
`../synthetic-retrieval/SYNTHETIC-analytics-retrieval-v6.csv`. Its twelve cases
improved top-1 from 5/12 to 12/12, hit@5 from 10/12 to 12/12, and mean reciprocal
rank from 0.625 to 1.00. Earlier production-path artifacts remain unchanged for
historical reference.
