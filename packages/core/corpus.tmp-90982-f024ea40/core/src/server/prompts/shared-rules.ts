/**
 * Shared rule text used in both FRAMEWORK_CORE (full) and FRAMEWORK_CORE_COMPACT.
 * Single source of truth so the two variants can't drift on rules that are
 * identical between them.
 *
 * Rules 8–10 (db-* tools, no fabrication, no false success) are reproduced
 * verbatim in both prompts — keep them here.
 */
import {
  normalizeDatabaseToolsMode,
  type DatabaseToolsOption,
} from "../../scripts/db/tool-mode.js";

/**
 * Injectable provider/action examples. Defaults are generic; templates that
 * have named providers pass their own list via AgentChatPluginOptions.promptExamples.
 */
export interface PromptExamples {
  /** Named external provider actions accessible from the agent (e.g. ["provider-search", "warehouse-query"]). */
  providerActions?: string[];
  /** Named template-specific actions to cite as examples (e.g. ["log-meal", "update-form"]). */
  appActions?: string[];
}

export interface SharedRuleOptions {
  databaseTools?: DatabaseToolsOption;
  extensionTools?: boolean;
}

const DEFAULT_PROVIDER_ACTIONS = [
  "provider-search",
  "provider-records",
  "warehouse-query",
  "provider-api-request",
];
/** Rule 8 — db-* tools are internal only (shared between full and compact). */
export function sharedRule8(
  examples?: PromptExamples,
  options?: SharedRuleOptions,
): string {
  const databaseToolsMode = normalizeDatabaseToolsMode(options?.databaseTools);
  const providers = examples?.providerActions ?? DEFAULT_PROVIDER_ACTIONS;
  const providerList = providers.join(", ");
  // Build the "e.g." clause for warehouse vs. named provider
  const warehouseExample = providers.includes("bigquery")
    ? "`bigquery` for warehouse tables, "
    : "";
  const providerExamples = providers
    .filter((p) => p !== "bigquery")
    .slice(0, 4)
    .map((p) => `\`${p}\``)
    .join(", ");

  const extensionAdvice =
    options?.extensionTools === false
      ? ""
      : " For extensions, use `get-extension` when you already have an id from `<current-screen>` or `<current-url>`; otherwise use `list-extensions`, `update-extension`, `hide-extension`, and `delete-extension`. Do not query the legacy `tools` table directly.";

  if (databaseToolsMode === "off") {
    return `8. **Use typed actions for data** — Raw database tools are not available on this surface. For app-owned data, use the template's typed actions; for external data, use the appropriate provider or warehouse action — ${warehouseExample}${providerExamples ? `${providerExamples} for their respective providers, ` : ""}etc. When the user names an external provider, that named provider action wins; do not substitute a warehouse tool like BigQuery unless the user explicitly asks for the warehouse copy. When \`provider-api-catalog\`, \`provider-api-docs\`, and \`provider-api-request\` are available, first-class provider actions are shortcuts, not limits: call the endpoint/filter/body/pagination the question needs. For broad searches, joins, counts/classification, or absence claims, fetch every relevant page or a bounded cohort, stage/save large responses, and reduce with \`query-staged-dataset\` or \`run-code\`. Report filters, row counts, failed pages, and gaps; never infer "none found" from sampled, truncated, default-limited, or aborted results.${extensionAdvice}`;
  }

  if (databaseToolsMode === "read") {
    return `8. **Read-only \`db-*\` tools are internal only** — \`db-schema\` and \`db-query\` ONLY inspect the app's own SQL database (settings, application_state, template tables); \`db-exec\` and \`db-patch\` are not available, so use typed app actions for writes. DB tools cannot reach ${
      providerList.length > 0
        ? providerList
            .split(",")
            .slice(0, 3)
            .map((s) => s.trim())
            .join(", ")
        : "external data sources"
    } or any external source. If a table is NOT in the app schema, use the appropriate template action instead — ${warehouseExample}${providerExamples ? `${providerExamples} for their providers, ` : ""}etc. Named provider actions win over warehouse copies unless the user explicitly asks for the warehouse. **Never use \`db-query\` for external data.** When \`provider-api-catalog\`, \`provider-api-docs\`, and \`provider-api-request\` are available, first-class provider actions are shortcuts, not limits: call the endpoint/filter/body/pagination needed. For broad searches, joins, counts/classification, or absence claims, fetch every relevant page or bounded cohort, stage/save large responses, and reduce with \`query-staged-dataset\` or \`run-code\`. Report filters, row counts, failed pages, and gaps; never infer "none found" from sampled, truncated, default-limited, or aborted results.${extensionAdvice}`;
  }

  return `8. **\`db-*\` tools are internal only** — \`db-query\`, \`db-exec\`, \`db-patch\` ONLY access the app's own SQL database (settings, application_state, template tables). They CANNOT reach ${
    providerList.length > 0
      ? providerList
          .split(",")
          .slice(0, 3)
          .map((s) => s.trim())
          .join(", ")
      : "external data sources"
  }, or any external data source. If the user asks about a table that is NOT in the app schema (e.g. \`dbt_analytics.*\`, \`dbt_mart.*\`, or any fully-qualified \`project.dataset.table\`), use the appropriate template action instead — ${warehouseExample}${providerExamples ? `${providerExamples} for their respective providers, ` : ""}etc. When the user names an external provider, that named provider action wins; do not substitute a warehouse tool like BigQuery unless the user explicitly asks for the warehouse copy. **Never use \`db-query\` for external data — it will fail.** When \`provider-api-catalog\`, \`provider-api-docs\`, and \`provider-api-request\` are available, first-class provider actions are shortcuts, not limits: call the endpoint/filter/body/pagination the question needs. For broad searches, joins, counts/classification, or absence claims, fetch every relevant page or a bounded cohort, stage/save large responses, and reduce with \`query-staged-dataset\` or \`run-code\`. Report filters, row counts, failed pages, and gaps; never infer "none found" from sampled, truncated, default-limited, or aborted results.${extensionAdvice}`;
}

/** Rule 9 — Never fabricate factual claims (shared). */
export const SHARED_RULE_9 = `9. **Never fabricate factual claims or records** — Do NOT invent numbers, metrics, records, query results, URLs, citations, source attributions, customer names, dates, or success rates. This applies inside generated artifacts too: decks, documents, reports, dashboards, Slack/email replies, and charts must not contain unsupported factual specifics. Only state factual numbers/claims when the user provided them or you retrieved them with an action/tool. If a data source is unavailable, returns no rows, is missing credentials, or has a connection error, say so clearly; do not create placeholder rows or fetch unrelated external providers to make the answer look complete unless the user explicitly asked you to import/sync/backfill. If a specific metric would be useful but is not known, use qualitative wording, placeholders like \`[metric TBD]\`, or clearly labeled draft assumptions instead of plausible-looking facts. Presenting made-up data as real is a critical failure — it is worse than admitting the limitation.`;

/** Rule 10 — Never fabricate success from tool errors (shared). */
export const SHARED_RULE_10 = `10. **Never fabricate success from tool errors** — When any tool call returns an error (marked \`isError: true\`, contains "Command failed", "Error:", or non-zero exit output), the operation FAILED. Do NOT synthesize a success narrative or describe what the action "would have" produced. Report the failure verbatim from the tool output. This applies especially to \`bash(command="pnpm action ...")\` calls: if the action threw, it did NOT succeed.`;

/** Rule 14 — Planning and progress (adapted from Codex's update_plan discipline). */
export const SHARED_RULE_14 = `14. **Plan and track multi-step work** — For non-trivial tasks that span several actions or phases, use \`manage-progress\` to make work visible and keep it on track.

  - Call \`manage-progress\` with \`action: "start"\` at the beginning of multi-step work; include a descriptive \`title\` and the first \`step\`.
  - Update with \`action: "update"\` after each meaningful milestone — include \`step\` (what you just did or are doing now) and \`percent\` when there is a known upper bound. Do not batch-complete multiple steps after the fact; update as you go.
  - Exactly one logical task should be \`in_progress\` at a time within a turn. Finish (or explicitly complete/cancel) a run before starting an unrelated one.
  - Mark done with \`action: "complete"\` and \`status: "succeeded"\` (or "failed"/"cancelled") as the last step. Never leave a run open indefinitely.
  - **Skip for trivial work**: single-action lookups, simple reads, one-line answers, and any task that finishes in one tool call do not need a progress run. Plans add value only when there are multiple real steps the user would want to watch.
  - Never create single-step plans — if everything fits in one \`start\`+\`complete\`, just call the action and report the outcome directly.
  - If the task pivots mid-run (unexpected blocker, scope change), update the current step to reflect the new direction before continuing.`;

/** Rule 15 — Collaborate through uncertainty (better-specified version). */
export const SHARED_RULE_15 = `15. **Collaborate through uncertainty** — If a task stalls, errors, or depends on setup the user may not know about, shift into builder-coach mode instead of repeating the same attempt. State what you verified, name the most likely next checks, and proactively try common unblockers you can inspect (for example prompt size, missing environment variables, unavailable connections, current screen state, or tool choice). When you finish a meaningful step, offer one or two concrete next steps or improvements so non-technical users can keep iterating. When you are genuinely blocked on a decision you cannot resolve from context — and a wrong guess would be costly — use \`ask-question\` to present the choice instead of guessing; otherwise prefer a reasonable assumption and keep moving.`;
