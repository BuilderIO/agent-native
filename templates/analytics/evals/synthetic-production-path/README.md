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

To emit candidate-only CSV for a specific production-code revision, pass its
40-character Git revision and `ANALYTICS_EVAL_EMIT_CSV=1`:

```sh
ANALYTICS_EVAL_GIT_REVISION=<git-revision> ANALYTICS_EVAL_EMIT_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-production-path/production-path.spec.ts
```

The serializer exposes only synthetic case IDs, candidate phase, Git and code
revisions, fixture revision, run number, coded score and reason, expected rank
and hit@5, action counts, completion/abort state, aggregate token counts, and
elapsed time. It rejects additional fields. Prompts, model output, tool inputs
and results, SQL, identities, and fixture values are never serialized. Scores
measure retrieval and production-path integrity with a deterministic test
engine; they do not measure hosted-model answer quality.

The checked-in CSV contains four candidate runs across two synthetic metadata
retrieval cases. The role-aware group roster ranked second in both runs; the
monthly count ranked first in both, for 2/4 top-1 and 4/4 hit@5. It contains no
baseline rows: the previous `phase=before` mode only relabeled a run of the
current working tree and did not load pinned baseline code, so those rows were
withdrawn. This harness refuses before-phase output. A valid before/after
comparison needs a separate run against an isolated, pinned baseline checkout.
The existing CSV filename retains its historical `before-after` suffix, but
its current contents are candidate-only. The broader eight-case synthetic
retrieval benchmark is recorded separately in
`../synthetic-retrieval/SYNTHETIC-analytics-retrieval.csv`.
