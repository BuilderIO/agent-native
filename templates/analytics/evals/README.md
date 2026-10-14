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

## Synthetic source and grain cases

`production-source-cases.eval.ts` adds seven synthetic questions. They ask for
source selection, declared grain, and relation or field attribution; they do
not use captured prompts, people, identifiers, event rows, or production result
values. Their scorer rejects failed or aborted runs, email-shaped output, and
calls outside the metadata-only tool set. The CLI still runs each case through
this directory's production adapter and the shared production agent loop.

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
