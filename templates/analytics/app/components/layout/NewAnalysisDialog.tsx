import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  useSendToAgentChat,
  PromptComposer,
  useActionQuery,
} from "@agent-native/core/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  IconAlertCircle,
  IconCheck,
  IconDatabase,
  IconLoader2,
  IconPlus,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  credentialRowsFromStatus,
  getConfiguredDataSources,
  type DataSourceStatusResponse,
} from "@/lib/data-source-status";

const ANALYSIS_CONTEXT =
  "The user wants to kick off a new ad-hoc analysis. " +
  "REAL_DATA_REQUIRED: before saving or answering, run at least one real data-source query action; `data-source-status`, `list-data-dictionary`, `generate-chart`, and `save-analysis` do not count as data queries. " +
  "If no source can answer, report the exact unavailable/error result instead of saving a guessed analysis. " +
  "Read the `adhoc-analysis` skill first. Then: gather data from relevant sources, " +
  "synthesize findings, and save via `save-analysis` with --id, --name, --question, " +
  "--description, --instructions (markdown recipe for re-running), --resultMarkdown (polished writeup), " +
  "--dataSources (JSON array of data sources used), and --resultData (structured raw query results and metrics from the successful data-source actions). " +
  "After saving, call `navigate --view=analyses --analysisId=<id>` so the user sees it. " +
  "No code files to create — analyses are persisted settings data.";

function buildAnalysisContext(configuredSourceNames: string[]): string {
  const sourceContext = configuredSourceNames.length
    ? `Call \`data-source-status\` first to verify source availability. Current credential status shows these configured data sources: ${configuredSourceNames.join(", ")}. Prefer those sources unless the user names a different provider. The data dictionary can describe metrics, but it is not a live data source by itself.`
    : "Current credential status shows no configured data sources. Check `data-source-status` before analysis. If the requested provider is unavailable or missing credentials, report the exact connection problem and direct the user to Data Sources instead of saving guessed results. The data dictionary can describe metrics, but it is not a live data source by itself.";
  return `${ANALYSIS_CONTEXT} ${sourceContext}`;
}

export function NewAnalysisDialog() {
  const [open, setOpen] = useState(false);
  const { send, isGenerating } = useSendToAgentChat();
  const { data: statusData, isLoading: isStatusLoading } = useActionQuery(
    "data-source-status",
    undefined,
    {
      staleTime: 10_000,
    },
  );
  const status = statusData as DataSourceStatusResponse | undefined;
  const envStatus = credentialRowsFromStatus(status);
  const configuredSources = useMemo(
    () => getConfiguredDataSources(envStatus),
    [envStatus],
  );
  const configuredSourceNames = configuredSources.map((source) => source.name);
  const statusMessage = status?.message || status?.error;

  function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    send({
      message: trimmed,
      context: buildAnalysisContext(configuredSourceNames),
      submit: true,
    });
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={isGenerating}
          className={cn(
            "flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-all",
            isGenerating
              ? "text-primary cursor-wait"
              : "text-muted-foreground/60 hover:text-primary hover:bg-sidebar-accent/50",
          )}
        >
          {isGenerating ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : (
            <IconPlus className="h-3 w-3" />
          )}
          {isGenerating ? "Generating..." : "New Analysis"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] p-3 sm:w-[420px]"
        side="right"
        align="start"
      >
        <p className="px-1 pb-2 text-sm font-semibold text-foreground">
          New analysis
        </p>
        <div
          className={cn(
            "mb-3 rounded-md border px-3 py-2 text-xs",
            configuredSources.length > 0
              ? "border-emerald-500/25 bg-emerald-500/10"
              : "border-amber-500/25 bg-amber-500/10",
          )}
        >
          <div className="flex gap-2">
            {isStatusLoading ? (
              <IconLoader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : configuredSources.length > 0 ? (
              <IconCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : (
              <IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <IconDatabase className="h-3.5 w-3.5 text-muted-foreground" />
                {isStatusLoading
                  ? "Checking data sources"
                  : configuredSources.length > 0
                    ? `${configuredSources.length} source${configuredSources.length === 1 ? "" : "s"} configured`
                    : "No data sources configured"}
              </div>
              {configuredSources.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {configuredSources.slice(0, 4).map((source) => (
                    <Badge
                      key={source.id}
                      variant="secondary"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      {source.name}
                    </Badge>
                  ))}
                  {configuredSources.length > 4 && (
                    <Badge
                      variant="outline"
                      className="px-1.5 py-0 text-[10px]"
                    >
                      +{configuredSources.length - 4} more
                    </Badge>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-muted-foreground">
                  {statusMessage ||
                    "Connect a source first, or ask the agent to help wire one up."}{" "}
                  <Link to="/data-sources" className="text-primary underline">
                    Manage sources
                  </Link>
                </p>
              )}
            </div>
          </div>
        </div>
        <PromptComposer
          autoFocus
          disabled={isGenerating}
          placeholder="Describe the question you want to investigate..."
          draftScope="analytics:new-analysis"
          onSubmit={handleSubmit}
        />
      </PopoverContent>
    </Popover>
  );
}
