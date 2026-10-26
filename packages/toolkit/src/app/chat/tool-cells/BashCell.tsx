import { useT } from "@agent-native/core/client/i18n";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconChevronDown,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconLoader2,
  IconTerminal2,
} from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import { AnimatedCollapse } from "../chat/tool-call-display.js";

export interface BashCellMeta {
  toolKind: "bash";
  command: string;
  cwd: string;
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
}

interface BashCellProps {
  meta: BashCellMeta;
  output?: string;
  isRunning: boolean;
}

const MAX_VISIBLE_LINES = 500;
const TOOL_CELL_ROW_CLASS =
  "agent-kit-activity-row flex w-full min-w-0 items-center gap-2 py-1 text-start text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-muted/50 focus-visible:outline-none";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function BashCell({ meta, output, isRunning }: BashCellProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const hasOutput = output && output.trim().length > 0;
  const canExpand = hasOutput;

  useEffect(() => {
    if (isRunning && expanded && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, isRunning, expanded]);

  const exitCode = meta.exitCode;
  const succeeded =
    exitCode === 0 || exitCode === null || exitCode === undefined;
  const failed = exitCode !== null && exitCode !== undefined && exitCode !== 0;

  const lines = output ? output.split("\n") : [];
  const visibleLines =
    showAll || lines.length <= MAX_VISIBLE_LINES
      ? lines
      : lines.slice(lines.length - MAX_VISIBLE_LINES);
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="my-1 w-full">
      <button
        type="button"
        onClick={() => canExpand && setExpanded((e) => !e)}
        className={cn(
          TOOL_CELL_ROW_CLASS,
          canExpand ? "cursor-pointer" : "cursor-default",
        )}
        aria-expanded={canExpand ? expanded : undefined}
      >
        <span className="flex shrink-0">
          {isRunning ? (
            <IconLoader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : failed ? (
            <IconCircleX className="size-4 text-destructive" />
          ) : (
            <IconCircleCheck className="agent-kit-tone-positive size-4" />
          )}
        </span>
        <IconTerminal2 className="size-4 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate font-mono text-foreground">
          {meta.command}
        </span>

        <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs">
          {!isRunning && meta.durationMs !== undefined && (
            <span className="flex items-center gap-0.5 tabular-nums">
              <IconClock className="size-3.5" aria-hidden="true" />
              {formatDuration(meta.durationMs)}
            </span>
          )}
          {!isRunning && exitCode !== undefined && exitCode !== null && (
            <span
              className={cn(
                "rounded px-1 font-medium tabular-nums",
                succeeded
                  ? "agent-kit-tone-positive bg-[hsl(var(--agent-kit-positive)/0.1)]"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {exitCode}
            </span>
          )}
          {meta.timedOut && (
            <span className="agent-kit-tone-warning rounded bg-[hsl(var(--agent-kit-warning)/0.1)] px-1 font-medium">
              {t("agentChat.toolCells.timedOut")}
            </span>
          )}
          {canExpand && (
            <IconChevronDown
              aria-hidden="true"
              className={cn(
                "size-4 opacity-60 transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          )}
        </span>
      </button>

      <AnimatedCollapse open={expanded && Boolean(hasOutput)}>
        {hasOutput && (
          <div className="mt-1 overflow-hidden rounded-md border border-border/60 bg-background">
            {hiddenCount > 0 && !showAll && (
              <div className="border-b border-border/40 px-3 py-1 text-xs text-muted-foreground">
                <button
                  type="button"
                  className="cursor-pointer underline hover:text-foreground"
                  onClick={() => setShowAll(true)}
                >
                  {t("agentChat.toolCells.showEarlierLines", {
                    count: hiddenCount,
                  })}
                </button>
              </div>
            )}
            <pre
              ref={outputRef}
              className="max-h-[60vh] overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground"
            >
              {visibleLines.join("\n")}
            </pre>
          </div>
        )}
      </AnimatedCollapse>
    </div>
  );
}
