/**
 * BashCell — renders a bash tool call with a collapsible terminal-style output.
 *
 * Shows:
 *  - Header: `$ <command>` + exit-code badge + duration
 *  - Body:   monospace streaming output, stick-to-bottom while running,
 *            capped at MAX_VISIBLE_LINES by default (expandable)
 */

import { useEffect, useRef, useState } from "react";
import {
  IconChevronDown,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconLoader2,
  IconTerminal2,
} from "@tabler/icons-react";
import { cn } from "../utils.js";

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
  /** Raw tool output string from the agent. */
  output?: string;
  isRunning: boolean;
}

/** Lines shown before "show all" is offered. */
const MAX_VISIBLE_LINES = 500;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function BashCell({ meta, output, isRunning }: BashCellProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  const hasOutput = output && output.trim().length > 0;
  const canExpand = hasOutput;

  // Stick to bottom while running
  useEffect(() => {
    if (isRunning && expanded && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, isRunning, expanded]);

  const exitCode = meta.exitCode;
  const succeeded =
    exitCode === 0 || exitCode === null || exitCode === undefined;
  const failed = exitCode !== null && exitCode !== undefined && exitCode !== 0;

  // Render output lines with optional cap
  const lines = output ? output.split("\n") : [];
  const visibleLines =
    showAll || lines.length <= MAX_VISIBLE_LINES
      ? lines
      : lines.slice(lines.length - MAX_VISIBLE_LINES);
  const hiddenCount = lines.length - visibleLines.length;

  return (
    <div className="my-1 overflow-hidden rounded-md border border-border/60">
      {/* Header */}
      <button
        type="button"
        onClick={() => canExpand && setExpanded((e) => !e)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-mono",
          isRunning
            ? "bg-muted text-muted-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent cursor-pointer",
          !canExpand && "cursor-default",
        )}
        aria-expanded={canExpand ? expanded : undefined}
      >
        {/* Status icon */}
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : failed ? (
            <IconCircleX className="h-3 w-3 text-destructive" />
          ) : (
            <IconCircleCheck className="h-3 w-3 text-emerald-500" />
          )}
        </span>

        {/* Terminal icon + command */}
        <IconTerminal2 className="h-3 w-3 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {meta.command}
        </span>

        {/* Badges */}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {!isRunning && meta.durationMs !== undefined && (
            <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              <IconClock className="h-2.5 w-2.5" />
              {formatDuration(meta.durationMs)}
            </span>
          )}
          {!isRunning && exitCode !== undefined && exitCode !== null && (
            <span
              className={cn(
                "rounded px-1 py-0.5 text-[10px] font-semibold",
                succeeded
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-destructive/10 text-destructive",
              )}
            >
              {exitCode}
            </span>
          )}
          {meta.timedOut && (
            <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              timeout
            </span>
          )}
          {canExpand && (
            <IconChevronDown
              className={cn("h-3 w-3 opacity-40", expanded && "rotate-180")}
            />
          )}
        </span>
      </button>

      {/* Output body */}
      {expanded && hasOutput && (
        <div className="border-t border-border/40 bg-background">
          {hiddenCount > 0 && !showAll && (
            <div className="border-b border-border/40 px-3 py-1 text-[11px] text-muted-foreground">
              <button
                type="button"
                className="cursor-pointer underline hover:text-foreground"
                onClick={() => setShowAll(true)}
              >
                Show {hiddenCount} earlier lines
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
    </div>
  );
}
