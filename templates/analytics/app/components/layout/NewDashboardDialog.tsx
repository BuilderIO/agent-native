import {
  useSendToAgentChat,
  PromptComposer,
  useT,
} from "@agent-native/core/client";
import { IconPlus } from "@tabler/icons-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const DASHBOARD_CONTEXT =
  "The user wants to create a new analytics dashboard. " +
  "TEMPLATE FIRST — If the user names an existing dashboard as a template to clone/base this on, resolve its id first (use `list-sql-dashboards` if you only have a title), then call `get-sql-dashboard` with `includeConfig: true` immediately and inspect `panels[].chartType`. " +
  'If any panel is `chartType: "extension"`, this is an extension-backed dashboard: call `get-extension` for that panel\'s `config.extensionId`, clone/adapt it with `create-extension` (apply the requested customer/org filters), then save a new dashboard via `update-dashboard` that embeds the new extension panel (`chartType: "extension"`, `config.extensionId`). Do not rebuild an extension template as guessed SQL/BigQuery panels. ' +
  "LARGE EXTENSION CLONE — Extension bodies can be very large (tens of thousands of characters). Call `get-extension` with `forceContent: true` exactly ONCE and reuse that body; a second same-run read intentionally omits `content` (you'll see `contentOmitted`), so don't treat that as the content being gone. Call `create-extension` / `update-extension` as NATIVE tools — they are mutating actions and cannot be invoked from `run-code`/`appAction`. For customer-specific clones, change only the small static config block (e.g. `ACCOUNT_USAGE_STATIC`) and prefer a focused `update-extension` edit over regenerating the whole HTML. Never shovel the full body through `run-code` or chat; if you stage it in a workspace scratch file, read it back with `workspaceRead` (which returns the whole file). " +
  "REAL_DATA_REQUIRED: before presenting numbers or authoring new SQL that invents tables/columns/filters, run at least one real data-source query action; `data-source-status`, `list-data-dictionary`, `get-sql-dashboard`, `get-extension`, `update-dashboard`, `mutate-dashboard`, and dry-run validation do not count as data queries. It is OK to inspect a template, clone an extension shell, ask one clarifying question (org id / account filter), or report an exact unavailable/error result without running a data query, as long as you do not invent metrics. " +
  "The `demo` source is reserved for the built-in Node Exporter demo and does not satisfy REAL_DATA_REQUIRED unless the user explicitly asks to work on that demo dashboard. " +
  "If no source can answer, report the exact unavailable/error result instead of saving a dashboard with guessed schema or metrics. " +
  "SQL PANELS — Only for native SQL dashboards (not template clones of an extension-backed dashboard): create a SQL-driven dashboard by calling the `update-dashboard` action with `dashboardId` and `config`. " +
  "The config shape is: { name: string, panels: [{ id, title, sql, source, chartType, width, tab?, config? }] }. " +
  "Each panel needs: id (unique string), title, sql (the query), source ('bigquery' | 'ga4' | 'amplitude' | 'first-party' | 'demo' | 'prometheus'), " +
  "chartType ('line' | 'area' | 'bar' | 'metric' | 'table' | 'pie'), width (1 or 2). " +
  "Optional tab labels can use 'Group / Tab' for primary and secondary dashboard tabs. " +
  "Optional config: { xKey, yKey, yKeys, color, colors, yFormatter ('number'|'currency'|'percent'), description, valueLabels }. " +
  "For first-party analytics, source is 'first-party' and sql may read analytics_events only; do not use db-query for datasource panels. " +
  "For the built-in demo dashboard, source is 'demo' and sql uses the same Prometheus JSON descriptor shape as source 'prometheus': { promql, mode, range, step }. " +
  "Call `data-source-status` if you need to see which data sources are connected. " +
  "Refer to AGENTS.md, .agents/skills, the data dictionary, and connected data-source instructions for SQL patterns and table names. " +
  "NO code files need to be created — only the dashboard config JSON via `update-dashboard`. " +
  "After saving, call the `navigate` action with view='adhoc' and dashboardId so the new dashboard opens immediately.";

export function NewDashboardDialog() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { send, isGenerating } = useSendToAgentChat();

  function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    send({ message: trimmed, context: DASHBOARD_CONTEXT, submit: true });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-muted-foreground/60 hover:bg-sidebar-accent/50 hover:text-primary">
          <IconPlus className="h-3 w-3" />
          {t("dialogs.newDashboard")}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] p-3 sm:w-[420px]"
        side="right"
        align="start"
      >
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          {t("dialogs.newDashboardTitle")}
        </p>
        <PromptComposer
          autoFocus
          disabled={isGenerating}
          placeholder={t("dialogs.newDashboardPlaceholder")}
          draftScope="analytics:new-dashboard"
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}
