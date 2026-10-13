# SYNTHETIC: Analytics retrieval benchmark

This deterministic benchmark compares the current shared Analytics
query-catalog matcher and ranker with the implementation in `origin/main` at
revision `8ff15a5577e6530316d59c4e4b2aa751a8f56a63`. Case names, questions,
expected outcomes, panel SQL, and data values are synthetic. These rows are
not historical chats, production data, or production end-to-end results.

Every table, column, grain description, and exclusion rule in these fixtures is
invented. The cases preserve only the retrieval contrasts under test, such as
a period aggregate versus a row-level membership bridge. They do not copy
Builder.io model names, columns, or membership policies.

The baseline candidate order was measured by loading the exact
`rankAnalyticsQueryCatalog` implementation from that pinned revision and
running the same fixtures with `measure-baseline.ts`. The measured order is
stored in `benchmark.ts`; the checked-in CSV records the source and fixture
revisions. The normal `--check` command compares the CSV with this recorded
baseline and the current ranker; it does not load or re-run the baseline code.
To reproduce or re-measure it, install the pinned baseline in a separate
checkout and pass its path:

```sh
git worktree add --detach /tmp/analytics-eval-before 8ff15a5577e6530316d59c4e4b2aa751a8f56a63
pnpm --dir /tmp/analytics-eval-before install --frozen-lockfile
ANALYTICS_BASELINE_ROOT=/tmp/analytics-eval-before \
  pnpm --filter analytics exec tsx evals/synthetic-retrieval/measure-baseline.ts
```

The measurement script rejects a checkout whose `HEAD` does not equal the
pinned revision. Re-measure the baseline when changing the comparison base; do
not update the revision without running this command.

The after results call `rankAnalyticsQueryCatalog` directly with fixed
fixtures. The eleven cases cover a built-in dictionary alias (`MRR`), a term
found only in panel SQL, semantic-scope selection, approved versus generated
dictionary trust, off-topic `Connect` text, a role-aware organization roster
versus a period aggregate, product activity versus membership metadata,
preserving aggregate retrieval for a highest-count question, active-only
membership versus product events, and two non-positive count forms on a
row-level membership request, including the metadata-only instruction appended
by the search action. The synthetic
period aggregate has a daily refresh, final-day completed periods, a partial
current period, and an invented sandbox exclusion rule. The CSV marks every
row `SYNTHETIC` and includes the expected candidate's rank under both methods.
This measures retrieval ranking only; it does not measure answer quality,
latency, or the mounted production chat path.
Across these eleven cases, top-1 improves from 6/11 to 11/11, hit@5 from 10/11
to 11/11, and mean reciprocal rank from 0.7273 to 1.00.

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
