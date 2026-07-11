/**
 * WriteCell — renders a write tool call as a new-file view with added-line styling.
 */

import {
  IconChevronDown,
  IconFilePlus,
  IconLoader2,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import { AnimatedCollapse } from "../chat/tool-call-display.js";
import { cn } from "../utils.js";

export interface WriteCellMeta {
  toolKind: "write";
  filePath: string;
  content?: string;
  truncated?: boolean;
  lineCount?: number;
}

interface WriteCellProps {
  meta: WriteCellMeta;
  isRunning: boolean;
}

const MAX_COLLAPSED_LINES = 40;

const FileContentView = memo(function FileContentView({
  content,
  maxLines,
}: {
  content: string;
  maxLines: number | null;
}) {
  const lines = content.split("\n");
  const visible = maxLines !== null ? lines.slice(0, maxLines) : lines;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full border-collapse font-mono text-[11px] leading-relaxed">
        <tbody>
          {visible.map((line, idx) => (
            <tr key={idx} className="bg-emerald-500/8 dark:bg-emerald-400/8">
              <td className="w-8 select-none border-r border-border/30 px-1.5 text-right text-[10px] text-muted-foreground/60">
                {idx + 1}
              </td>
              <td className="w-4 select-none text-center text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                +
              </td>
              <td className="px-2 text-emerald-800 dark:text-emerald-200">
                <span
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                >
                  {line}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export function WriteCell({ meta, isRunning }: WriteCellProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const hasContent = Boolean(meta.content);
  const lines = meta.content ? meta.content.split("\n") : [];
  const totalLines = lines.length;
  const maxCollapsed =
    showAll || totalLines <= MAX_COLLAPSED_LINES ? null : MAX_COLLAPSED_LINES;
  const hiddenLines =
    maxCollapsed !== null ? totalLines - MAX_COLLAPSED_LINES : 0;

  return (
    <div className="my-1 overflow-hidden rounded-md border border-border/60">
      {/* Header */}
      <button
        type="button"
        onClick={() => hasContent && setExpanded((e) => !e)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-mono",
          isRunning
            ? "bg-muted text-muted-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent",
          hasContent && "cursor-pointer",
          !hasContent && "cursor-default",
        )}
        aria-expanded={hasContent ? expanded : undefined}
      >
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : (
            <IconFilePlus className="h-3 w-3 text-emerald-500" />
          )}
        </span>

        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {meta.filePath}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {meta.lineCount !== undefined && !isRunning && (
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              +{meta.lineCount}
            </span>
          )}
          {meta.truncated && (
            <span className="text-[10px] text-muted-foreground">(partial)</span>
          )}
          {hasContent && (
            <IconChevronDown
              className={cn("h-3 w-3 opacity-40", expanded && "rotate-180")}
            />
          )}
        </span>
      </button>

      {/* Content body */}
      <AnimatedCollapse open={expanded && hasContent}>
        {meta.content && (
          <div className="border-t border-border/40 bg-background">
            <FileContentView content={meta.content} maxLines={maxCollapsed} />
            {hiddenLines > 0 && (
              <div className="border-t border-border/40 px-3 py-1 text-[11px] text-muted-foreground">
                <button
                  type="button"
                  className="cursor-pointer underline hover:text-foreground"
                  onClick={() => setShowAll(true)}
                >
                  Show {hiddenLines} more lines
                </button>
              </div>
            )}
          </div>
        )}
      </AnimatedCollapse>
    </div>
  );
}
