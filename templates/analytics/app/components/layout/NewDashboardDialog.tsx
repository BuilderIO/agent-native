import { useState } from "react";
import { useSendToAgentChat } from "@agent-native/core/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function NewDashboardDialog() {
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState("");
  const { send, isGenerating, codeRequiredDialog } = useSendToAgentChat();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    const today = new Date().toISOString().slice(0, 10);

    send({
      message: prompt.trim(),
      context:
        "The user wants to create a new analytics dashboard. " +
        `REQUIRED: Set lastUpdated="${today}" in the registry entry. ` +
        "Create a new dashboard page in client/pages/adhoc/ with the appropriate charts and data. " +
        "Register it in client/pages/adhoc/registry.ts (both the dashboards array and dashboardComponents map). " +
        "Use DashboardHeader component at the top. " +
        "Use the existing patterns: useMetricsQuery for BigQuery data, KpiChart or Recharts for charts, " +
        "and the Card component for layout. Refer to AGENTS.md and docs/learnings.md for table mappings and query patterns.",
      submit: true,
      requiresCode: true,
    });

    setPrompt("");
    setOpen(false);
  }

  return (
    <>
      {codeRequiredDialog}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            disabled={isGenerating}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-all",
              isGenerating
                ? "text-primary cursor-wait"
                : "text-muted-foreground/60 hover:text-primary hover:bg-sidebar-accent/50",
            )}
          >
            {isGenerating ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
            {isGenerating ? "Generating..." : "New Dashboard"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-4" side="right" align="start">
          <form onSubmit={handleSubmit}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the dashboard you want to create..."
              className={cn(
                "flex w-full rounded-md border border-input bg-background px-3 py-3 text-sm",
                "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50",
                "min-h-[140px] resize-y",
              )}
              autoFocus
              required
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  if (prompt.trim()) handleSubmit(e);
                }
              }}
            />
            <div className="flex justify-end mt-3">
              <button
                type="submit"
                disabled={!prompt.trim() || isGenerating}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isGenerating ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Generating...
                  </span>
                ) : (
                  "Create"
                )}
              </button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
    </>
  );
}
