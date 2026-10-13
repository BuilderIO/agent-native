# Synthetic production-path retrieval harness

This harness runs the shared production agent loop with the Analytics
production prompt, read-only action registry, final-response guard, explicit
synthetic caller identity, and usage capture. Its deterministic in-memory
engine emits one `find-data` call and a safe metadata-only closeout; it does
not call a hosted model.

The fixtures use invented group and member entities, synthetic table and
column names, and an artificial test-member exclusion rule. They contain no
production model names, source definitions, production membership policy, or
identities.
Catalog reads use fixture-backed Analytics dictionary, source-index, and
dashboard storage seams. Embedding discovery is disabled so the test cannot
read credentials or call an embedding provider. The action allowlist contains
only `find-data`; warehouse and connected-data actions are unavailable to the
loop. Eval results are never persisted.

Run it from the repository root:

```sh
pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The `before` phase is accepted only when the checkout is exactly pinned to
`8ff15a5577e6530316d59c4e4b2aa751a8f56a63`; the supplied Git revision must
match `git rev-parse HEAD`. It also requires a clean baseline source tree and
checks every production-path source file against the pinned commit's bytes.
The only allowed untracked file is the copied `production-path.spec.ts` harness
shown below. The `after` phase also requires the supplied revision to match the
current checkout and rejects that baseline commit. These checks prevent dirty
source from being labeled as baseline and prevent a phase label from silently
rerunning one code version twice.

To reproduce the baseline, create a detached worktree at the pinned revision,
copy this harness into it, install that revision's locked dependencies, then
run the same production-path cases:

```sh
git worktree add --detach /tmp/analytics-eval-before 8ff15a5577e6530316d59c4e4b2aa751a8f56a63
mkdir -p /tmp/analytics-eval-before/templates/analytics/evals/synthetic-production-path
cp templates/analytics/evals/synthetic-production-path/production-path.spec.ts \
  /tmp/analytics-eval-before/templates/analytics/evals/synthetic-production-path/
cd /tmp/analytics-eval-before
pnpm install --frozen-lockfile
ANALYTICS_EVAL_PHASE=before \
  ANALYTICS_EVAL_GIT_REVISION=8ff15a5577e6530316d59c4e4b2aa751a8f56a63 \
  ANALYTICS_EVAL_EMIT_CSV=1 \
  pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

For the candidate, pass the current 40-character Git revision and
`ANALYTICS_EVAL_PHASE=after` with `ANALYTICS_EVAL_EMIT_CSV=1`:

```sh
ANALYTICS_EVAL_PHASE=after \
  ANALYTICS_EVAL_GIT_REVISION=$(git rev-parse HEAD) \
  ANALYTICS_EVAL_EMIT_CSV=1 \
  pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The serializer exposes only synthetic case IDs, before/after phase, Git and code
revisions, fixture revision, run number, coded score and reason, expected rank
and hit@5, action counts, completion/abort state, aggregate token counts, and
elapsed time. It rejects additional fields. Prompts, model output, tool inputs
and results, SQL, identities, and fixture values are never serialized. Scores
measure retrieval and production-path integrity with a deterministic test
engine; they do not measure hosted-model answer quality.

The current seven-case comparison is in
`SYNTHETIC-analytics-production-path-v4-before-after.csv`. It has two runs per
case for both the pinned baseline and candidate, using the same deterministic
synthetic engine, storage fixtures, action allowlist, and production agent
loop. In addition to the earlier roster, monthly count, product activity,
product-user identity, and active product-user cases, it covers active
workspace members with roles and a row-level lookup with negated count wording.
It records Git and source-code revisions separately so reviewers can verify
both implementations. Top-1 retrieval improved from 4/14 baseline runs to
14/14 candidate runs; hit@5 improved from 12/14 to 14/14. The five-case v3
comparison and earlier four-case comparison remain unchanged for historical
reference. The eleven-case synthetic retrieval benchmark is recorded
separately in `../synthetic-retrieval/SYNTHETIC-analytics-retrieval.csv`.
