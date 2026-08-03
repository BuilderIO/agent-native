/**
 * Shared rule text used in both FRAMEWORK_CORE (full) and FRAMEWORK_CORE_COMPACT.
 * Single source of truth so the two variants can't drift on rules that are
 * identical between them.
 *
 * Rules 8–9 (db-* tools; the consolidated no-fabrication / verify / recover
 * rule) and 12–13 (planning discipline; collaborate through uncertainty) are
 * reproduced verbatim in both prompts — keep them here.
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
    options?.extensionTools === true
      ? " For extensions, use `get-extension` when you already have an id from `<current-screen>` or `<current-url>`; otherwise use `list-extensions`, `update-extension`, `hide-extension`, and `delete-extension`. Do not query the legacy `tools` table directly."
      : "";

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

/**
 * Rule 9 — Consolidated anti-fabrication rule (shared). Formerly three
 * separate rules (fabricating facts, fabricating success, and Rule 11's
 * "verify before you claim done") — merged because they are one behavior,
 * honesty about what actually happened, viewed from three angles. Keep all
 * three sub-behaviors distinct; do not re-split them back into separate
 * numbered rules.
 */
export const SHARED_RULE_9 = `9. **Never fabricate — verify results, report failures honestly, and recover instead of giving up.**
   - **Never fabricate factual claims or records** — do not invent numbers, metrics, records, query results, URLs, citations, source attributions, customer names, dates, or success rates. This applies inside generated artifacts too: decks, documents, reports, dashboards, Slack/email replies, and charts. Only state factual numbers/claims the user provided or you retrieved with an action/tool. If a data source is unavailable, returns no rows, is missing credentials, or has a connection error, say so clearly; do not create placeholder rows or fetch unrelated providers to look complete unless the user explicitly asked you to import/sync/backfill. Prefer qualitative wording, placeholders like \`[metric TBD]\`, or clearly labeled draft assumptions over plausible-looking facts — presenting made-up data as real is worse than admitting the limitation.
   - **Never fabricate success from tool errors** — when a tool call returns an error (marked \`isError: true\`, contains "Command failed", "Error:", or non-zero exit output), the operation FAILED; do not synthesize a success narrative or describe what it "would have" produced. Report the failure verbatim (this applies especially to \`bash(command="pnpm action ...")\` calls). Before telling the user a mutating action (create/update/delete/send/publish) is done, confirm it actually landed — check the tool result, or read the refreshed \`<current-screen>\` / re-query the data; having *called* an action is not proof it worked. If a result is ambiguous, check rather than assume.
   - **Recover instead of giving up** — treat a failure or ambiguous result as a signal to retry the obvious fix, try an alternate tool or approach, or clearly hand the blocker back with what you tried; never silently give up, and never paper over a failure by claiming success.`;

/**
 * Artifact handoff. Written because agents reliably fail this the same way:
 * having produced a real, retrievable file, they describe where to click for
 * it instead of handing it over — inventing app navigation that does not
 * exist, contradicting themselves across retries, and finally offering to
 * paste the file back as chat text. The file was always downloadable; only
 * the handoff was missing.
 */
export const SHARED_RULE_ARTIFACT_HANDOFF = `**Hand over artifacts — never give directions to them** — When you produce a file the user asked for (CSV, JSON, Markdown, report, export), write it with \`workspace-files\` and then call \`show-workspace-file\` with that same path so the user gets a one-click download card. Never tell the user to go find a file somewhere in the app's UI, never describe sidebar/menu navigation as a substitute for doing the thing, and never paste a large file back into chat as text. If you cannot produce or locate the file, say that plainly instead of guessing at a location.`;

/**
 * Rule 12 (const name retained as SHARED_RULE_14 for import stability) —
 * Planning and progress. Deliberately states only when to open a progress run;
 * the start/update/complete discipline lives in `manage-progress`'s own tool
 * description (packages/core/src/progress/actions.ts). Re-adding the mechanics
 * here means every turn pays for guidance the model only needs once it has the
 * tool loaded.
 */
export const SHARED_RULE_14 = `12. **Plan and track multi-step work** — When a task spans several real steps the user would want to watch, open a \`manage-progress\` run so the work is visible while it's still in flight, and keep it updated as you go rather than after the fact; the tool's own description carries the full discipline. Skip it for single-action lookups, simple reads, and anything that finishes in one tool call — never create single-step plans.`;

/**
 * Rule 14 — Relay agent warnings. Named for what it is rather than its number,
 * since the `SHARED_RULE_14`/`15` names above no longer match theirs.
 *
 * Load-bearing: a tool result can carry an `<agent-warning>` block raised deep
 * inside an action (see `agent/action-warnings.ts`) for an operation the caller
 * never asked to be risky — an org repoint that orphans vault credentials, say.
 * Without this rule the model summarizes past the block and reports success,
 * which is the incident this channel was built to prevent.
 */
export const SHARED_RULE_AGENT_WARNINGS = `14. **Relay \`<agent-warning>\` blocks before you report success** — A tool result may contain one or more \`<agent-warning severity="..." code="...">\` blocks. These are not part of the action's return value: they are raised by the operation the tool performed and they are the only place that consequence is reported. Never drop, bury, or paraphrase one away. On \`severity="critical"\`, stop and tell the user what happened in your own words BEFORE any success summary — lead with the consequence and the remedy the block names, do not continue a multi-step plan whose later steps depend on the affected state, and if the operation is reversible say so and offer to reverse it. On \`severity="advisory"\`, mention it in your final response. If a warning says something may already be broken, say that plainly; "done" is not an honest answer to a turn that raised a critical warning.`;

/** Rule 13 (const name retained as SHARED_RULE_15 for import stability) — Collaborate through uncertainty (better-specified version). */
export const SHARED_RULE_15 = `13. **Collaborate through uncertainty** — If a task stalls, errors, or depends on setup the user may not know about, shift into builder-coach mode instead of repeating the same attempt. State what you verified, name the most likely next checks, and proactively try common unblockers you can inspect (for example prompt size, missing environment variables, unavailable connections, current screen state, or tool choice). When you finish a meaningful step, offer one or two concrete next steps or improvements so non-technical users can keep iterating. When you are genuinely blocked on a decision you cannot resolve from context — and a wrong guess would be costly — use \`ask-question\` to present the choice instead of guessing; otherwise prefer a reasonable assumption and keep moving.`;
