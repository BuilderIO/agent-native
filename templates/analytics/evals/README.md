# Analytics evals

Run the Analytics eval suite with an explicit caller identity:

```sh
pnpm exec agent-native eval --owner-email person@example.com --org-id org_example --json
```

The Analytics adapter assembles the production framework prompt, Analytics
instructions, initial tools, read-only action registry, and request-time catalog
prefetch. It invokes the shared production `runAgentLoop` with the real Analytics
final-response guard, caller email, organization id, abort signal, and usage
capture. The runner checks a bounded receipt for those conditions. A failed or
timed-out catalog prefetch is reported to the model as a context note, as in
production; the agent can still search with its tools. Aborted runs, missing
guard/usage, skipped cases, and incorrect answers fail the eval.

This exercises the shared production agent-loop boundary; it does not dispatch
through the mounted HTTP chat handler or its thread/run persistence path. The
CLI passes `persist: false`, so it does not write eval-result rows. Identity
must come from these CLI flags or an explicitly injected resolver; it is never
read from environment variables or app configuration.

If either identity value or the production adapter is missing, the command
exits with an error before running or scoring any case.

## Production path before and after

`results/analytics-smartness-before-after.csv` contains two runs per phase for
the same redacted synthetic case based on the reported Builder.io user and
organization question. It is not a replay of Brent's historical chat. The CSV
contains only run timing, token and tool counts, credits, and scorer outcomes;
it has no prompts, transcripts, emails, identifiers, row values, or secrets.

Both phases completed through the production agent loop, but both failed the
source-contract scorer because the production organization had no generated
source index configured at evaluation time. Mean latency fell from 101.4s to
83.7s (17.4%), mean LLM calls from 14.5 to 12 (17.2%), and mean input tokens
from 908k to 855k (5.8%). This establishes a faster lookup path, not an
accuracy improvement. The generated index now includes the missing membership
grains; rerun the same cases after the index is imported to measure the
accuracy gain. No production index or data rows were written for this eval.

## Latest synthetic question wave

The [synthetic query-path report](./synthetic-query-path/README.md) and
[paired CSV](./synthetic-query-path/SYNTHETIC-analytics-query-quality-v12-main-vs-pr7639.csv)
compare the current `origin/main` snapshot at measurement time
`3f47617d227fea07f81794b691ff05825ba1c52d` with candidate code snapshot
`aa87722a87478159776e61700ba6902aa59123b4`. Seventeen synthetic questions run
twice per phase through the production path: baseline 10/34 checks passed and
the candidate passed 34/34. Every row carries production-path, final-guard,
owner/org-context, and usage receipts. The phases use the same harness SHA-256
`a434740fd2152ec36e740edf85a1587677dca9e0c445308124e42b6219b7cd14`.

The deterministic engine scripts tool sequences and final responses, and
provider results are mocked. This measures production-path and guard contracts,
not model choices or live warehouse accuracy. The CSV contains no prompts,
transcripts, query text, provider rows, identity values, or secrets.

### Previous synthetic wave (v8)

The [synthetic query-path report](./synthetic-query-path/README.md) and
[paired CSV](./synthetic-query-path/SYNTHETIC-analytics-query-quality-v8-main-vs-pr7639.csv)
compare the pinned `origin/main` baseline
`929369c0493edf4e3208c287db9374b8aa893d49` with
Analytics code at `b94e08e86c994675be76f395b84e12f7fcafdb18` over thirteen
synthetic questions, with two production-path runs per question. The baseline
passed 10/26 contract checks; the candidate passed 26/26. The new annual-period
case shows the candidate recovering from an all-time query and rerunning the
exact 2025 range in both replicates. The deterministic engine scripts the tool
sequence and final response, and provider results are mocked, so this measures
production-path and guard contracts, not model choices or live warehouse
accuracy. The day-first natural-date fix in the evaluated revision is covered by
focused regression tests. See the report for the scope and limits of the
comparison. Since the pinned baseline, `origin/main` advanced to
`29301697a09d1e096e3070a8d3d4da3276c93094`; no changes landed in
`templates/analytics`, `packages/core/src`, or `packages/shared` in between.

The earlier [v2 paired CSV](./synthetic-query-path/SYNTHETIC-analytics-query-quality-v2.csv)
is retained as a historical snapshot.

## Synthetic source and grain cases

### Historical production-path comparison v24 (superseded)

[`SYNTHETIC-analytics-production-path-v24-before-after.csv`](./synthetic-production-path/SYNTHETIC-analytics-production-path-v24-before-after.csv)
records two runs each for 25 synthetic cases on baseline `757e1dd35809` and
candidate `cf46270ac7ee`, using identical pinned harness bytes. This rerun
includes the dashboard join, BigQuery comment, and row-grain cadence fixes in
candidate `cf46270ac7ee`; later PR revisions are not covered. The measured
candidate code hash is
`sha256:090fa4775bcd5cae7bc3896d27bd58be65a68672356eefc4d90f92217e0b794e`;
the shared harness hash is
`sha256:c75aaf0790f81dc25897143367bb374b5669baf03e9ef5231635be12421bd9bc`.
It includes a case where the only membership reference is a monthly aggregate.

- Case-contract accuracy rose from 46/50 runs (92%) to 50/50 (100%).
- Positive-source top-1 retrieval rose from 46/48 (95.8%) to 48/48 (100%).
- Correct abstentions rose from 0/2 to 2/2; unexpected aggregate matches fell
  from 2/2 to 0/2.
- All 100 runs completed through the production agent loop and called only the
  metadata-only `find-data` action once; there were no aborts or failed actions.
- Mean harness latency rose from 35.0 ms to 59.1 ms. This is local synthetic
  timing, not a production latency measurement.

The v23 CSV remains available as historical evidence. V24 is a historical
source-pinned measurement for candidate `cf46270ac7ee`, superseded by later PR
revisions; it does not measure the current PR head. This deterministic
harness uses a synthetic model and in-memory source index; it is not a
hosted-model, BigQuery-connection, or production-data test, and it does not
replay Brent's historical chat. The CSV contains only synthetic case IDs,
bounded metrics, and provenance hashes. No production rows, prompts,
transcripts, user identifiers, or secrets were used.

### Production-path retrieval comparison v22

[`SYNTHETIC-analytics-production-path-v22-before-after.csv`](./synthetic-production-path/SYNTHETIC-analytics-production-path-v22-before-after.csv)
records two runs each for 25 synthetic cases on baseline `1da583a5059d` and
candidate `4021bd355e7d`, using the same pinned production-path harness. The
suite includes an abstention case where the only available membership source
is a monthly aggregate.

- Case-contract accuracy rose from 46/50 runs (92%) to 50/50 (100%).
- Positive-source top-1 retrieval rose from 46/48 (95.8%) to 48/48 (100%).
- Correct abstentions rose from 0/2 to 2/2; unexpected aggregate matches fell
  from 2/2 to 0/2.
- All 100 runs completed through the production agent loop, called `find-data`
  exactly once, and had no aborts.

The separate [ranker-only 12-case v6 artifact](./synthetic-retrieval/SYNTHETIC-analytics-retrieval-v6.csv)
reports top-1 5/12 and hit@5 10/12 on its pinned baseline, versus 12/12 for
both metrics with the current matcher. It tests catalog ranking directly, not
the production agent path.

This is a deterministic harness with a synthetic model and in-memory source
index, not a hosted-model, BigQuery-connection, or production-latency test. Its
small latency and token figures describe only the harness. It does not replay
Brent's historical chat or establish broad real-world answer accuracy. The
separate production-model artifact above remains a single redacted case where
both phases failed the source-contract scorer because no production source
index was configured at measurement time.

`production-source-cases.eval.ts` adds seven synthetic source questions and one
synthetic dbt-connection readiness question. The source questions check source
selection, declared grain, and relation or field attribution; the dbt case
checks connection state and abstention from metric values. They do not use
captured prompts, people, identifiers, event rows, or production result values.
Their scorer rejects failed or aborted runs, email-shaped output, and calls
outside each case's metadata-only tool set. The CLI runs each case through this
directory's production adapter and the shared production agent loop.

The expected source contracts are:

- Builder.io user roster: `dbt_mart.dim_users_core` at user grain,
  `dbt_mart.dim_organizations` at organization grain, joined through
  `dbt_intermediate.user_organization_role` at user-organization membership
  grain. `dbt_mapping.user_id_to_org_id` is also a real one-row-per-membership
  map with `user_id`, `organization_id`, and `is_root_org`; it does not carry
  `organization_role`, so it cannot replace the role bridge for role-aware
  rosters.
- Builder.io current and historical counts: `dbt_mart.organization_user_count`
  is one row per organization per date; `dbt_mart.aggregate_monthly_users_per_org`
  is one row per organization per month.
- Builder.io monthly membership counts: `aggregate_monthly_users_per_org.user_count`
  counts distinct memberships whose email does not end in `@builder.io`;
  `internal_user_count` counts distinct memberships whose email does end in
  `@builder.io`. This is an email-address split, not a verified employee or
  staff roster. Completed months use the last calendar day as their cutoff; the
  in-progress month is a partial snapshot as of today. This domain rule is
  specific to this historical membership model, not a generic spam or
  active-user definition.
- Builder.io product activity: `fact_builder_activity`, using its dbt-declared
  activity fact grain rather than a user or organization dimension.
- Agent-Native accounts and telemetry: `dim_agent_native_users` for accounts
  and `stg_analytics__first_party_events` for event-grain telemetry.
- Connect product events: `stg_analytics__first_party_events`, whose Connect
  dashboard source is `first_party_analytics_events_raw` at event grain. These
  events do not define Builder.io product user or organization counts.

The eval prompts ask for schemas and model definitions only. They explicitly
prohibit querying production rows or returning counts, and their scorer fails
if a row-query action is called. The core eval runner also fails the case when
the production adapter returns `ok: false` after an abort or other run error.
