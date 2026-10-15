# SYNTHETIC: Analytics retrieval benchmark

This deterministic benchmark compares the current shared Analytics query-catalog
matcher and ranker with the implementation in `origin/main` at pinned revision
`f99e655433a40fcd5d82e3e84667a8e8576c956a`. Case names, questions, expected
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
git worktree add --detach /tmp/analytics-eval-before f99e655433a40fcd5d82e3e84667a8e8576c956a
pnpm --dir /tmp/analytics-eval-before install --frozen-lockfile
ANALYTICS_BASELINE_ROOT=/tmp/analytics-eval-before \
  pnpm --filter analytics exec tsx evals/synthetic-retrieval/measure-baseline.ts
```

The measurement script rejects a checkout whose `HEAD` does not equal the
pinned revision and rejects edits to the two baseline ranker files. Re-measure
the baseline when changing the comparison base; do not update the revision
without running the measurement command.

The fourteen cases cover a built-in dictionary alias (`MRR`), a term found only
in panel SQL, semantic-scope selection, approved versus generated dictionary
trust, a synthetic product-user directory versus organization membership grain,
a role-aware roster versus a period aggregate, product activity versus
membership metadata, aggregate retrieval for a highest-count question,
active-only membership versus product events, bare active members versus product
events, two non-positive count forms on a row-level membership request, and a
time-scoped active-user metric versus monthly seats and publishing-only activity.
The CSV marks every row `SYNTHETIC` and records the expected candidate's rank under
both implementations. Its active-user cases distinguish Builder product events
from Agent-Native app opens. Ambiguous active-user wording retains both source
definitions so the agent can ask which population is intended. This measures
retrieval ranking only; it does not
measure answer quality, latency, or the mounted production chat path.

`SYNTHETIC-analytics-retrieval-v7.csv` is retained as the preceding synthetic
case snapshot. Version 8 is the current benchmark and adds the app-open routing
case.

Across these fourteen cases, top-1 improves from 13/14 to 14/14, hit@5 improves
from 13/14 to 14/14, and mean reciprocal rank improves from 13/14 to 1.00.

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
