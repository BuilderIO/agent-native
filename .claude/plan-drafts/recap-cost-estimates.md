# Cost estimates for PR recaps

**Brief:** Capture the model + input/output/cached token counts and a dollar
cost estimate on every PR recap, stored as queryable columns so spend can be
analyzed later. Source the numbers from the CI agent CLI's own usage output
(reliable), not from the LLM self-reporting (impossible mid-run).

> Draft source-of-truth for the `/visual-plan` publish. Lives here only because
> the `agent-native-plan` MCP tools were not reachable in the session that drafted
> it (connector healthy, harness had not indexed the late-connecting server).
> Publish via `create-visual-plan` — do not ship inline.

---

## Objective & done criteria

Every PR recap row carries: the model that authored it, raw input / output /
cache-read / cache-write / reasoning token counts, a dollar-cost snapshot, the
pricing version used for that snapshot, and a "provider-reported vs estimated"
flag. The recap list card and detail header show a compact `gpt-5.5 · $0.42 ·
318K tok` chip. The data is plain typed columns on the `plans` table so it can
be queried directly for analysis.

**Done =** schema columns + additive migration; a `record-plan-usage` action;
multi-provider pricing in core; CI workflow captures usage from the agent CLI and
records it; list/detail surface the chip; `/visual-recap` skill notes the optional
inline `usage` field; tests green (`pnpm prep`).

## Where this lives (grounded)

- Recaps are rows in the **single** `plans` table — `kind: "recap"` —
  `templates/plan/server/db/schema.ts:19`. No model/token/cost field exists today.
- Created by the `create-visual-recap` MCP action
  (`templates/plan/actions/create-visual-recap.ts`), which delegates to
  `import-visual-plan-source.ts` with `kind: "recap"`. The insert is there.
- The PR recap path is the **PR Visual Recap GitHub Action**
  (`.github/workflows/pr-visual-recap.yml`): a real coding agent (Claude Code
  `claude -p …` **or** Codex `codex exec …`, model via `VISUAL_RECAP_MODEL`,
  e.g. `gpt-5.5`) runs the `visual-recap` skill, calls `create-visual-recap`,
  and writes the plan URL to `recap-url.txt`. That `.txt` is the agent's ONLY
  current hand-off.
- The framework already has a cost engine — `packages/core/src/usage/store.ts`:
  `calculateCost()` (centicents), `recordUsage()`, a `token_usage` table, and a
  `PRICING` map — but the map is **Anthropic-only** (catch-all prices everything
  as Sonnet, which is wrong for `gpt-5.5`) and is keyed by owner/app, not joinable
  to a recap.
- The recap CLI subcommands (`scan`/`build-prompt`/`shot`/`comment`) live in
  `packages/core/src/cli/recap.ts`, dispatched by `runRecap()`. The workflow YAML
  also has a byte-identical bundled copy at
  `packages/core/src/cli/pr-visual-recap-workflow.ts` guarded by a sync test in
  `recap.spec.ts` — edit both together.

## The load-bearing decision: where do the numbers come from?

An LLM cannot report its own cumulative token usage mid-run, so the recap agent
calling `create-visual-recap` can't reliably self-attach cost. But the **CI
wrapper can** — both agent CLIs emit machine-readable usage:

- **Claude Code** `claude -p … --output-format json` → final result JSON with
  `total_cost_usd` (provider-computed!), `usage` (input/output/cache tokens),
  `modelUsage`, `num_turns`.
- **Codex** `codex exec --json` → JSONL event stream incl. a final token-count /
  usage event (tokens; cost is table-derived for OpenAI).

So the recap workflow captures usage from the CLI's structured output after the
run, then records it against the just-created recap. Reliable, exact for Claude,
table-estimated for Codex/GPT.

A secondary path stays open: an optional `usage` field on `create-visual-recap`
for any agent/host that already knows its usage and wants to attach it inline.

## Data model (additive, nullable columns on `plans`)

Mirror the `token_usage` naming. All nullable so the migration is additive
(repo rule) and old recaps simply read null.

| column                   | type | meaning                                                    |
| ------------------------ | ---- | ---------------------------------------------------------- |
| `llm_model`              | text | model id, e.g. `gpt-5.5`, `claude-opus-4-8`                |
| `llm_input_tokens`       | int  | prompt tokens (non-cached)                                 |
| `llm_output_tokens`      | int  | completion tokens                                          |
| `llm_cache_read_tokens`  | int  | cache hits                                                 |
| `llm_cache_write_tokens` | int  | cache writes                                               |
| `llm_reasoning_tokens`   | int  | reasoning tokens (GPT-5.5 etc.)                            |
| `llm_cost_cents_x100`    | int  | dollar cost snapshot (centicents, like `token_usage`)      |
| `llm_cost_source`        | text | `provider-reported` (Claude total_cost_usd) \| `estimated` |
| `llm_pricing_version`    | text | pricing-table version used for the snapshot                |
| `llm_usage_recorded_at`  | text | ISO timestamp                                              |

**Why raw tokens AND a cost snapshot:** prices drift, so the token counts are
the durable truth (always re-derivable); the snapshot is for fast list rendering
and "what we believed it cost at the time," tagged with `llm_pricing_version` so
it stays interpretable. **Why columns, not a JSON blob or the core `token_usage`
table:** the stated goal is _analysis_, which wants queryable typed columns; and
`token_usage` is keyed by owner/app, not joinable to a `planId`. Reuse core's
`calculateCost()` for the math; store the result on the recap row.

## Write path

1. **Server helper** `writePlanUsage(planId, usage)` in `templates/plan/server/plans.ts`:
   computes `costCentsX100` via core `calculateCost()` when not provider-reported,
   stamps `llm_pricing_version`, writes the columns, `assertAccess`-scoped.
2. **Action** `record-plan-usage` (`templates/plan/actions/`): input
   `{ planId, model, inputTokens, outputTokens, cacheReadTokens?, cacheWriteTokens?,
reasoningTokens?, costCentsX100?, costSource? }`. Exposed on the action surface
   - MCP so external agents can attach usage directly, and reachable from the CLI
     step with the connect token. Funnels through `writePlanUsage`.
3. **Optional inline** `usage` field on `create-visual-recap` →
   `import-visual-plan-source` insert, for callers that already know their usage.

## Pricing (core, multi-provider, versioned)

Extend `PRICING` in `packages/core/src/usage/store.ts` to be multi-provider
(add OpenAI / GPT-5.5, leave room for Gemini) and add a `PRICING_VERSION`
constant. Stop silently pricing unknown models as Sonnet — return a clearly-marked
"unknown/estimated" result instead. **Look up current per-model prices at
implementation time — never guess them** (per the always-latest rule). For Claude
recaps, prefer Claude Code's provider-reported `total_cost_usd` over the table.

## CI capture (workflow + bundled copy + sync test)

- Claude step: add `--output-format json`, tee result to `recap-usage.json`.
- Codex step: add `--json`, capture the final usage event to `recap-usage.json`.
- New step "Record usage" (after Read plan URL, gated on `ok=true`): parse
  `recap-usage.json`, call a new CLI subcommand
  `recap usage record --plan-url "$PLAN_URL" --token "$PLAN_RECAP_TOKEN"
--app-url "$PLAN_RECAP_APP_URL" --usage-json recap-usage.json`, which POSTs to
  `record-plan-usage`. `continue-on-error` — cost capture must never redden the job.
- Add the `recap usage record` subcommand to `runRecap()` in `recap.ts`.
- Regenerate the byte-identical `PR_VISUAL_RECAP_WORKFLOW_YML` in
  `pr-visual-recap-workflow.ts` (sync test).

Note: the workflow's self-modifying guard skips the recap on any PR that touches
`packages/core/**`, the workflow, or the skills — so the PR that ships this won't
get its own recap. Expected, not a problem.

## UI surface (small)

- Add the new columns to the `list-visual-plans` projection
  (`templates/plan/actions/list-visual-plans.ts`), `summarizePlans`, and
  `PlanSummary`/`Plan` types (`templates/plan/shared/types.ts`); add to
  `get-visual-plan`.
- Render a cost chip with the existing `Badge` + a Tabler `IconCoin`:
  - recap **card** metadata row in `PlansPage.tsx` (~`:4512`)
  - recap **detail header** eyebrow row in `PlanContentRenderer.tsx` (~`:429`)
  - format `gpt-5.5 · $0.42 · 318K tok`; tooltip with the in/out/cache breakdown;
    subtle "est." marker only when `llm_cost_source = estimated`.

## Skill / instructions

Note the optional inline `usage` field in the `visual-recap` SKILL.md. The recap
skill has multiple byte-identical copies guarded by `skills.sync.spec.ts` — edit
every copy together or the sync test fails.

## Scope

**In:** schema + migration; `record-plan-usage` + `writePlanUsage`; multi-provider
pricing + version in core; optional inline `usage` on create-recap; CLI `recap
usage record`; workflow capture (both agents) + bundled YAML sync; list/get
projection + types; cost chip in card + header; skill note; tests.

**Deferred (non-goals):** backfilling historical recaps (stay null); a cross-PR
cost analytics dashboard (data lands queryable now); Builder-credits display;
extending to forward `kind:"plan"` rows (columns are generic, flip on later);
per-tool-call attribution.

## Open questions

1. **Estimated vs provider-reported display.** Claude reports exact USD; Codex/GPT
   is table-estimated. Show one unified `$X` with a subtle "est." only when
   estimated (recommended) / always label "est." / store-only-don't-display-yet?
2. **Pricing providers for the first cut.** Anthropic + OpenAI now (recommended) /
   also add Google + others up front?
3. **Mirror into core `token_usage` too?** Also call `recordUsage()` with label
   `pr-recap:<n>` so recap spend shows in the unified usage view (recommended,
   cheap) / keep cost only on the recap row?
