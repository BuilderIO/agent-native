# SYNTHETIC: dbt Semantic Layer action evals

These cases use invented metric names and values. They verify the narrow
metric-by-name action contract with a mocked workspace connection and provider
response. They do not claim that the production Semantic Layer contains these
metrics or values.

`metric-by-name` checks that an exact metric request returns the known synthetic
value. `job-run-refused` checks that a request to run a dbt job is rejected by
the action schema before any provider call. The same cases are exercised by
`actions/query-dbt-semantic-metric.spec.ts`.

The production smoke check is separate and read-only: one `metricsPaginated`
metadata request against the granted dbt workspace connection. It does not
create a MetricFlow query, start a dbt job, or write to the production app.

## Routing cases

`dbt-semantic-layer.eval.ts` adds two synthetic agent-routing cases for the
metric `synthetic_active_accounts`. `dbt-semantic-layer.spec.ts` feeds canned
transcripts to each scorer.

- Owner metric: the first source query must be `query-dbt-semantic-metric`. A
  `bigquery` or dashboard query first fails.
- Unconnected org: `get-dbt-connection` must report `not_connected` or
  `token_missing`, and the answer must say it reads warehouse tables and is not
  the owner-approved Semantic Layer definition.

Both cases run against the same org in one live run. Run the suite once against
a connected org and once against an unconnected org; the unconnected case fails
on a connected org by design.
