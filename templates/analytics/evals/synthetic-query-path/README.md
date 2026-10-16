# Synthetic Analytics query-path eval

This suite runs seven invented questions through Analytics' real production chat
adapter, prompt builder, read-only action allowlist, shared agent loop, and final
response guard. A deterministic engine supplies the model steps. Provider
actions return bounded synthetic fixtures, so the suite does not connect to
BigQuery, dbt, Sigma, Amplitude, HubSpot, or production storage.

The cases cover an unbuilt index without an absence claim, source provenance
and ambiguous user/seat definitions, dbt connection absence, a dbt metric
continuation with date and organization/week grouping, a rolling three-month
campaign metric by product category, BigQuery rows returned with a warning, and
schema discovery followed by a corrected BigQuery query.
Each runs twice. No copied conversation, customer identity, production row,
query, credential, or secret is used.

## Run

```sh
pnpm --filter analytics exec vitest run evals/synthetic-query-path/production-path.spec.ts
```

To regenerate the privacy-safe result CSV from the same test run:

```sh
ANALYTICS_QUERY_EVAL_WRITE_CSV=1 pnpm --filter analytics exec vitest run evals/synthetic-query-path/production-path.spec.ts
```

Set `ANALYTICS_QUERY_EVAL_PHASE` to `baseline` or `candidate` and
`ANALYTICS_QUERY_EVAL_SOURCE_REVISION` to the exact source SHA before writing a
CSV. Each row includes that source revision and the SHA-256 of the shared test
harness, so paired baseline and candidate runs can be checked for identical
cases. The CSV allowlist contains only synthetic case keys, pass/fail reason
codes, production-path and guard booleans, action-call counts, and synthetic
token and latency counters. It deliberately excludes prompts, SQL, action
arguments, transcripts, provider rows, user/org/connection identifiers,
cursors, and tokens. The CSV is a repeatability artifact for this deterministic
fixture; it is not a live model benchmark or evidence of live warehouse
accuracy.

The dbt production-path case starts from a synthetic metadata continuation
cursor, then checks that the requested date range and grouping survive the
query and final-response guard. First-page cursor creation and signature
validation remain covered by the focused dbt action tests.

## Latest-wave comparison

The paired CSV records seven cases twice against the same harness bytes on
2026-10-16. `origin/main` at `d094432e55a24775ec08732527b26b943c464f4c`
passed 8/14 runs; the candidate code at
`39f8fcff1bd63e892e5e1145093caa8dab536574` passed 14/14. The three dbt cases
that failed both baseline repetitions passed both candidate repetitions:
connection-state abstention, paginated metric lookup with bounded grouping,
and a rolling three-month campaign metric by product category. The four other
cases passed in both phases. Every case/replicate pair and the harness SHA are
identical across phases.

This measures the production action, prompt, guard, and usage plumbing with a
deterministic scripted engine and synthetic provider results. It does not
measure model reasoning, live Builder data accuracy, or provider performance;
latency and token counters describe these local fixture runs only.

## dbt live validation

Live dbt validation is blocked because the current Analytics workspace has no
dbt Semantic Layer connection. This suite tests both a synthetic disconnected
response and a synthetic successful metric response, including metadata
continuation and bounded grouping. It does not claim to validate a live dbt
manifest, metric definition, or value. A live read-only check can be added once
an authorized workspace connection is available and a semantic metric has
been deployed successfully.
