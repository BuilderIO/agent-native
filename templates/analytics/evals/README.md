# Analytics evals

Run the Analytics eval suite with an explicit caller identity:

```sh
pnpm exec agent-native eval --owner-email person@example.com --org-id org_example --json
```

The Analytics adapter assembles the production framework prompt, Analytics
instructions, initial tools, read-only action registry, and request-time catalog
prefetch. It invokes the shared production `runAgentLoop` with the real Analytics
final-response guard, caller email, organization id, abort signal, and usage
capture. The runner checks a bounded receipt for those conditions and rejects
failed or timed-out prefetch, missing guard/usage, skipped cases, or cancellation.

This exercises the shared production agent-loop boundary; it does not dispatch
through the mounted HTTP chat handler or its thread/run persistence path. The
CLI passes `persist: false`, so it does not write eval-result rows. Identity
must come from these CLI flags or an explicitly injected resolver; it is never
read from environment variables or app configuration.

If either identity value or the production adapter is missing, the command
exits with an error before running or scoring any case.

## Synthetic source and grain cases

`production-source-cases.eval.ts` adds six synthetic questions. They ask for
model selection and declared grain only; they do not use captured prompts,
people, identifiers, event rows, or production result values. Their scorer
rejects failed or aborted runs, email-shaped output, and calls outside the
metadata-only tool set. The CLI still runs each case through this directory's
production adapter and the shared production agent loop.

The expected source contracts are:

- Builder.io user roster: `dbt_mart.dim_users_core` at user grain,
  `dbt_mart.dim_organizations` at organization grain, joined through
  `dbt_intermediate.user_organization_role` at user-organization membership
  grain. The nonexistent `dbt_mapping.user_id_to_org_id` is not an accepted
  alternative.
- Builder.io current and historical counts: `dbt_mart.organization_user_count`
  is one row per organization per date; `dbt_mart.aggregate_monthly_users_per_org`
  is one row per organization per month.
- Builder.io month-end employee split: `aggregate_monthly_users_per_org.user_count`
  excludes `@builder.io` addresses and `internal_user_count` counts them. This
  email-domain rule is specific to that historical model; it is not a generic
  spam, employment, or active-user definition.
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
