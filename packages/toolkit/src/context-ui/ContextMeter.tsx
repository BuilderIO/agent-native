import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/tooltip.js";
import { cn } from "../utils.js";
import { formatContextTokens } from "./format.js";
import type { ContextManifestViewData } from "./types.js";

function ContextDonut({ pct, advisory }: { pct: number; advisory: boolean }) {
  const radius = 7.5;
  const circumference = 2 * Math.PI * radius;
  const displayPct = Math.max(3, Math.min(100, pct));
  const dashOffset = circumference - (displayPct / 100) * circumference;
  return (
    <span className="relative flex size-5 items-center justify-center">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="-rotate-90 size-5">
        <circle
          cx="10"
          cy="10"
          r={radius}
          className="stroke-muted"
          fill="none"
          strokeWidth="3"
        />
        <circle
          cx="10"
          cy="10"
          r={radius}
          className={cn(advisory ? "stroke-amber-500" : "stroke-[#00B5FF]")}
          fill="none"
          strokeLinecap="round"
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <span className="absolute size-2 rounded-full bg-background" />
    </span>
  );
}

export function ContextMeterView({
  manifest,
  contextWindow,
  open,
  onOpenChange,
  children,
}: {
  manifest: ContextManifestViewData;
  contextWindow: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const pct = Math.min(
    100,
    Math.round((manifest.totalTokens / contextWindow) * 100),
  );
  const { conversationTokens, systemTokens } = manifest;
  return (
    <TooltipProvider delayDuration={200}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Context ${pct}%, ${formatContextTokens(manifest.totalTokens)}${systemTokens > 0 ? ` total: ${formatContextTokens(systemTokens)} system + ${formatContextTokens(conversationTokens)} conversation` : ""}. Open Context X-Ray.`}
                className={cn(
                  "flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  open && "bg-accent/60 text-foreground",
                )}
              >
                <ContextDonut pct={pct} advisory={!manifest.enforceable} />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            Context {pct}% · {formatContextTokens(manifest.totalTokens)}
            {systemTokens > 0
              ? ` (${formatContextTokens(systemTokens)} system + ${formatContextTokens(conversationTokens)} conversation)`
              : ""}
          </TooltipContent>
        </Tooltip>
        <PopoverContent
          align="end"
          side="top"
          sideOffset={8}
          className="w-[min(92vw,380px)] overflow-hidden border-border/70 p-0"
        >
          {children}
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
