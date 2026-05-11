import { useState } from "react";
import { useSendToAgentChat, PromptComposer } from "@agent-native/core/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconPlus } from "@tabler/icons-react";

const DASHBOARD_CONTEXT =
  "The user wants to create a new analytics dashboard. " +
  "REAL_DATA_REQUIRED: before saving or answering, run at least one real data-source query action; `data-source-status`, `list-data-dictionary`, `update-dashboard`, and dry-run validation do not count as data queries. " +
  "If no source can answer, report the exact unavailable/error result instead of saving a dashboard with guessed schema or metrics. " +
  "Create a SQL-driven dashboard by calling the `update-dashboard` action with `dashboardId` and `config`. " +
  "The config shape is: { name: string, panels: [{ id, title, sql, source, chartType, width, config? }] }. " +
  "Each panel needs: id (unique string), title, sql (the query), source ('bigquery' | 'ga4' | 'amplitude' | 'first-party'), " +
  "chartType ('line' | 'area' | 'bar' | 'metric' | 'table' | 'pie'), width (1 or 2). " +
  "Optional config: { xKey, yKey, yKeys, color, colors, yFormatter ('number'|'currency'|'percent'), description }. " +
  "For first-party analytics, source is 'first-party' and sql may read analytics_events only; do not use db-query for datasource panels. " +
  "Call `data-source-status` if you need to see which data sources are connected. " +
  "Refer to AGENTS.md, .agents/skills, the data dictionary, and connected data-source instructions for SQL patterns and table names. " +
  "NO code files need to be created — only the dashboard config JSON via `update-dashboard`. " +
  "After saving, call the `navigate` action with view='adhoc' and dashboardId so the new dashboard opens immediately.";

export function NewDashboardDialog() {
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
          New Dashboard
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] p-3 sm:w-[420px]"
        side="right"
        align="start"
      >
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          New dashboard
        </p>
        <PromptComposer
          autoFocus
          disabled={isGenerating}
          placeholder="Describe the dashboard you want to create..."
          draftScope="analytics:new-dashboard"
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}
