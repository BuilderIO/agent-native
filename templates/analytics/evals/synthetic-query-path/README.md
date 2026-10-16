# Synthetic Analytics query-path eval

This suite runs twelve invented questions through Analytics' real production chat
adapter, prompt builder, read-only action allowlist, shared agent loop, and final
response guard. A deterministic engine supplies the model steps. Provider
actions return bounded synthetic fixtures, so the suite does not connect to
BigQuery, dbt, Sigma, Amplitude, HubSpot, or production storage.

The cases cover an unbuilt index without an absence claim, source provenance
and ambiguous user/seat definitions, dbt connection absence, a dbt metric
continuation with date and organization/week grouping, a rolling three-month
campaign metric by product category, event-taxonomy discovery, monthly AI-credit
usage by workspace, BigQuery rows returned with a warning, schema discovery
followed by a corrected BigQuery query, and Content API request counts kept
separate from related Visual Views metrics.
The latest wave adds organization-grain validation when dimension descriptions
contain unrelated hierarchy language, plus safe first-party DIV recovery.
Each runs twice. No copied conversation, customer identity, production row,
query, credential, or secret is used.

A separate production-path regression also scripts one unsupported FILTER
error followed by a corrected conditional aggregate. It checks that the
safe recovery instruction reaches the agent, the final response guard accepts
the later complete result, and backend details stay hidden. Its scripted model
steps make it a recovery-contract check, not an independent model-quality
benchmark, so it is not included in the paired CSV comparison below.

## Run

```sh
pnpm --filter analytics exec vitest run evals/synthetic-query-path/production-path.spec.ts
```

To write a privacy-safe per-phase CSV from the same test run:

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

## Current latest-wave comparison

[`SYNTHETIC-analytics-query-quality-v4-main-vs-pr7639.csv`](./SYNTHETIC-analytics-query-quality-v4-main-vs-pr7639.csv)
contains twelve synthetic questions run twice through the production path on
baseline `3215556c9c955b5e37ff359708f4ef527d019c4e` and candidate
`1646381a68280c05739656706a8d9fd8b3d4289f`. The baseline passed 10/24 runs;
the candidate passed 24/24. Seven cases failed both baseline repetitions:
Content API requests versus Visual Views, disconnected dbt abstention,
paginated MetricFlow grouping, rolling-window MetricFlow grouping, monthly AI
credits routing, organization-grain validation, and first-party DIV recovery.
Every baseline failure still has production-path, final-guard, owner/org-context,
and usage receipts; failures are scored as `contract_failed`, not missing
production-path evidence.

Every candidate row has production-path, final-guard, owner/org-context, and
usage receipts. The scorer checks the synthetic owner and org identity, while
the CSV records only a boolean and omits those identifiers. The organization
case also verifies `metric_time` with `WEEK` in both the captured action input
and returned query specification. Both phases use the same harness SHA-256,
`71a2f83b90ab627a755f57eeb3d50e6af63310fb32aadf84a404e2157669f997`, and every
case/replicate pair matches.

The baseline is the Analytics code from `3215556`; current `origin/main` is
`ec46c1d`. The commits since the baseline change Clips, Slides, and core store
registry/release files, with no Analytics source or shared production-path
changes. This is a deterministic scripted-engine contract comparison with
mocked provider responses. It does not measure independent model source
selection, live warehouse accuracy, real user outcomes, or provider latency.

### Previous v3 harness snapshot

[`SYNTHETIC-analytics-query-quality-v3-main-vs-pr7639.csv`](./SYNTHETIC-analytics-query-quality-v3-main-vs-pr7639.csv)
contains twelve synthetic questions run twice through the production path on
baseline `3215556c9c955b5e37ff359708f4ef527d019c4e` and candidate
`23a7fbcb06a1aae7ad3a2dbbec6dbda84bf3bbfb`. The baseline passed 10/24 runs;
the candidate passed 24/24. Seven cases failed in both baseline repetitions:
Content API requests versus Visual Views, disconnected dbt abstention,
paginated MetricFlow grouping, rolling-window MetricFlow grouping, monthly AI
credits routing, organization-grain validation, and first-party DIV recovery.
The two baseline DIV rows could not produce a production-path receipt because
the baseline lacks the typed error used by the recovery case; they are recorded
as `production_path_failed` with score 0, not as answer results.

Every candidate row has production-path, final-guard, and usage receipts. The
scorer also requires the synthetic owner and org identity to match, but the CSV
intentionally omits those identifiers. Both phases use the same harness
SHA-256, `1b88238acd5ddd2746183ef831a776e17fcbd24758f17ffbb7cfff37f938059e`,
and every case/replicate pair matches. The baseline was captured from
`origin/main` at `3215556`; at that checkpoint, main had advanced to `8e39342`
with only Slides files changed. The Analytics and shared production paths
under test were unchanged by that advance. The PR head now contains the
evaluated production change plus later test-harness-only updates.

This is a deterministic scripted-engine contract comparison with mocked
provider responses. It does not measure independent model source selection,
live warehouse accuracy, real user outcomes, or provider latency.

This snapshot is retained for audit history. Its earlier harness did not supply
a typed unsupported-SQL error on baseline for the DIV recovery case, so its two
baseline DIV rows were recorded as `production_path_failed`. Use the v4 CSV above
for the current comparison; v4 supplies the baseline's existing typed
unsupported-SQL error and includes the full privacy-safe owner/org-context
receipt.

### Previous v2 comparison

[`SYNTHETIC-analytics-query-quality-v2.csv`](./SYNTHETIC-analytics-query-quality-v2.csv)
records ten cases twice against identical harness bytes on
2026-10-16. The previous PR head `6e35888005449c43092b986d19c13366f3aad728`
passed 18/20 runs; candidate code at
`e70655bb09c80d5dea1a45f2bc38b63fd78804e5` passed 20/20. Both baseline runs
failed the related-metric guidance check for Content API requests versus
Visual Views; both candidate runs passed. The other nine cases passed in both
phases. The harness SHA-256 is
`30224599330eadac8dddcd25c936f7fec5d616fc2441a7c2d6aad081f51e8363` in both
phases, and every case/replicate pair matches.

The engine scripts the action sequence, query, and final response. The paired
score therefore measures the related-metric guidance check and production-path
plumbing; it does not show that a model independently selected the right
source, wrote the query, or answered correctly. It does not measure live
Builder data accuracy or provider performance. Latency and token counters
describe these local fixture runs only.

## Previous-wave comparison

[`SYNTHETIC-analytics-query-quality.csv`](./SYNTHETIC-analytics-query-quality.csv)
records the previous nine cases twice against the same harness
bytes. Baseline `38a66a8aacce6378e8dab2507b2612efcb3cbe81` passed 10/18 runs;
candidate `00decda5a73eb689647a630671036a88639d5bf5` passed 18/18. Four cases
failed both baseline repetitions and passed both candidate repetitions:
disconnected dbt abstention, paginated metric lookup with bounded grouping, a
rolling three-month metric, and monthly workspace-credit routing. The other
five cases passed in both phases.

## dbt live validation

Live dbt validation is blocked because the current Analytics workspace has no
dbt Semantic Layer connection. This suite tests both a synthetic disconnected
response and a synthetic successful metric response, including metadata
continuation and bounded grouping. It does not claim to validate a live dbt
manifest, metric definition, or value. A live read-only check can be added once
an authorized workspace connection is available and a semantic metric has
been deployed successfully.
