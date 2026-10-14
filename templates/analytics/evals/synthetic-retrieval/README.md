# SYNTHETIC: Analytics retrieval benchmark

This deterministic benchmark compares the current shared Analytics query-catalog
matcher and ranker with the implementation in `origin/main` at pinned revision
`75e39e8547b408aa09605e54872d9a8ef6522df9`. Case names, questions, expected
outcomes, panel SQL, table names, columns, and values are synthetic. These rows
are not historical chats, production data, or production end-to-end results.

The baseline candidate order was measured by loading the exact
`rankAnalyticsQueryCatalog` implementation from the pinned revision and running
the same synthetic cases with `measure-baseline.ts`. The measured rankings are
recorded in `benchmark.ts`; the checked-in CSV records both baseline and current
rankings. The normal `--check` command compares the CSV with those measured
baseline rankings and the current ranker. To reproduce or re-measure the
baseline, install the pinned revision in a separate checkout and pass its path:

```sh
git worktree add --detach /tmp/analytics-eval-before 75e39e8547b408aa09605e54872d9a8ef6522df9
pnpm --dir /tmp/analytics-eval-before install --frozen-lockfile
ANALYTICS_BASELINE_ROOT=/tmp/analytics-eval-before \
  pnpm --filter analytics exec tsx evals/synthetic-retrieval/measure-baseline.ts
```

The measurement script rejects a checkout whose `HEAD` does not equal the
pinned revision and rejects edits to the two baseline ranker files. Re-measure
the baseline when changing the comparison base; do not update the revision
without running the measurement command.

The twelve cases cover a built-in dictionary alias (`MRR`), a term found only
in panel SQL, semantic-scope selection, approved versus generated dictionary
trust, a synthetic product-user directory versus organization membership grain,
a role-aware roster versus a period aggregate, product activity versus
membership metadata, aggregate retrieval for a highest-count question,
active-only membership versus product events, bare active members versus product
events, and two non-positive count forms on a row-level membership request. The
CSV marks every row `SYNTHETIC` and records the expected candidate's rank under
both implementations. This measures retrieval ranking only; it does not
measure answer quality, latency, or the mounted production chat path.

Across these twelve cases, top-1 improves from 5/12 to 12/12, hit@5 improves
from 10/12 to 12/12, and mean reciprocal rank improves from 0.625 to 1.00.

From the repository root, regenerate the checked-in CSV with:

```sh
pnpm --dir templates/analytics exec tsx evals/synthetic-retrieval/benchmark.ts --write
```

Check that the checked-in CSV still matches the computed outputs with:

```sh
pnpm --dir templates/analytics exec tsx evals/synthetic-retrieval/benchmark.ts --check
```

The focused test also checks the CSV and expected ranking behavior:

```sh
pnpm --dir templates/analytics exec vitest run evals/synthetic-retrieval/benchmark.spec.ts
```
