import { useState } from "react";
import { useSendToAgentChat, PromptComposer } from "@agent-native/core/client";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { IconPlus, IconLoader2 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

const ANALYSIS_CONTEXT =
  "The user wants to kick off a new ad-hoc analysis. " +
  "Read the `adhoc-analysis` skill first. Then: gather data from relevant sources, " +
  "synthesize findings, and save via `save-analysis` with --id, --name, --question, " +
  "--instructions (markdown recipe for re-running), --resultMarkdown (polished writeup), " +
  "--sources (comma-separated data sources used), and --tags (comma-separated). " +
  "After saving, call `navigate --view=analyses --analysisId=<id>` so the user sees it. " +
  "No code files to create — analyses are persisted settings data.";

export function NewAnalysisDialog() {
  const [open, setOpen] = useState(false);
  const { send, isGenerating } = useSendToAgentChat();

  function handleSubmit(text: string) {
    const trimmed = text.trim();
    if (!trimmed || isGenerating) return;
    send({ message: trimmed, context: ANALYSIS_CONTEXT, submit: true });
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
