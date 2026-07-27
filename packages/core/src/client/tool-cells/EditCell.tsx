/**
 * EditCell — renders an edit tool call as a syntax-highlighted unified diff.
 *
 * The diff is computed client-side from oldText / newText stored in the
 * structured metadata.  The HighlightedCodeBlock from AssistantChat is not
 * accessible here, so we do a lightweight line-diff + per-line class approach
 * instead (no dep on shiki required for the diff view itself).
 *
 * Collapsed by default beyond MAX_COLLAPSED_LINES; expand button shows all.
 */

import {
  IconChevronDown,
  IconFile,
  IconFileDiff,
  IconLoader2,
} from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";

import { AnimatedCollapse } from "../chat/tool-call-display.js";
import { cn } from "../utils.js";

export interface EditCellMeta {
  toolKind: "edit";
  filePath: string;
  oldText?: string;
  newText?: string;
  truncated?: boolean;
}

interface EditCellProps {
  meta: EditCellMeta;
  isRunning: boolean;
}

/** Lines shown collapsed before "expand" is offered. */
const MAX_COLLAPSED_LINES = 40;

// ─── Diff computation ────────────────────────────────────────────────────────

interface DiffLine {
  kind: "context" | "added" | "removed";
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Simple Myers-style LCS via DP for line-level diffs.
  // For very large files we cap input to keep it snappy.
  const MAX_LINES = 2000;
  const a = oldLines.slice(0, MAX_LINES);
  const b = newLines.slice(0, MAX_LINES);

  const m = a.length;
  const n = b.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldLineNo = 1;
  let newLineNo = 1;

  while (i < m || j < n) {
    if (i < m && j < n && a[i] === b[j]) {
      result.push({
        kind: "context",
        text: a[i],
        oldLineNo: oldLineNo++,
        newLineNo: newLineNo++,
      });
      i++;
      j++;
    } else if (j < n && (i >= m || dp[i + 1][j] >= dp[i][j + 1])) {
      result.push({ kind: "added", text: b[j], newLineNo: newLineNo++ });
      j++;
    } else {
      result.push({ kind: "removed", text: a[i], oldLineNo: oldLineNo++ });
      i++;
    }
  }

  // Append any overflow lines as context
  if (oldLines.length > MAX_LINES) {
    for (let k = MAX_LINES; k < oldLines.length; k++) {
      result.push({
        kind: "removed",
        text: oldLines[k],
        oldLineNo: oldLineNo++,
      });
    }
  }
  if (newLines.length > MAX_LINES) {
    for (let k = MAX_LINES; k < newLines.length; k++) {
      result.push({
        kind: "added",
        text: newLines[k],
        newLineNo: newLineNo++,
      });
    }
  }

  return result;
}

/** Compute +N -N line counts from a diff. */
function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added++;
    else if (line.kind === "removed") removed++;
  }
  return { added, removed };
}

// ─── Component ───────────────────────────────────────────────────────────────

const DiffView = memo(function DiffView({
  lines,
  maxLines,
}: {
  lines: DiffLine[];
  maxLines: number | null;
}) {
  const visible = maxLines === null ? lines : lines.slice(0, maxLines);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-full border-collapse font-mono text-[11px] leading-relaxed">
        <tbody>
          {visible.map((line, idx) => (
            <tr
              key={idx}
              className={cn(
                line.kind === "added" &&
                  "bg-emerald-500/8 dark:bg-emerald-400/8",
                line.kind === "removed" && "bg-destructive/8",
              )}
            >
              {/* Old line number */}
              <td className="w-8 select-none border-r border-border/30 px-1.5 text-right text-[10px] text-muted-foreground/60">
                {line.oldLineNo ?? ""}
              </td>
              {/* New line number */}
              <td className="w-8 select-none border-r border-border/30 px-1.5 text-right text-[10px] text-muted-foreground/60">
                {line.newLineNo ?? ""}
              </td>
              {/* Sigil */}
              <td
                className={cn(
                  "w-4 select-none text-center text-[10px] font-bold",
                  line.kind === "added" &&
                    "text-emerald-600 dark:text-emerald-400",
                  line.kind === "removed" && "text-destructive",
                  line.kind === "context" && "text-muted-foreground/40",
                )}
              >
                {line.kind === "added"
                  ? "+"
                  : line.kind === "removed"
                    ? "-"
                    : " "}
              </td>
              {/* Content */}
              <td
                className={cn(
                  "px-2 text-foreground",
                  line.kind === "added" &&
                    "text-emerald-800 dark:text-emerald-200",
                  line.kind === "removed" && "text-red-800 dark:text-red-200",
                )}
              >
                <span
                  style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}
                >
                  {line.text}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
});

export function EditCell({ meta, isRunning }: EditCellProps) {
  const [expanded, setExpanded] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const diff = useMemo(() => {
    if (!meta.oldText && !meta.newText) return null;
    return computeLineDiff(meta.oldText ?? "", meta.newText ?? "");
  }, [meta.oldText, meta.newText]);

  const stats = useMemo(() => (diff ? diffStats(diff) : null), [diff]);
  const hasDiff = diff !== null && diff.length > 0;

  const totalLines = diff?.length ?? 0;
  const maxCollapsed =
    showAll || totalLines <= MAX_COLLAPSED_LINES ? null : MAX_COLLAPSED_LINES;
  const hiddenLines =
    maxCollapsed !== null ? totalLines - MAX_COLLAPSED_LINES : 0;

  return (
    <div className="my-1 overflow-hidden rounded-md border border-border/60">
      {/* Header */}
      <button
        type="button"
        onClick={() => hasDiff && setExpanded((e) => !e)}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-mono",
          isRunning
            ? "bg-muted text-muted-foreground"
            : "bg-muted text-muted-foreground hover:bg-accent",
          hasDiff && "cursor-pointer",
          !hasDiff && "cursor-default",
        )}
        aria-expanded={hasDiff ? expanded : undefined}
      >
        <span className="shrink-0">
          {isRunning ? (
            <IconLoader2 className="h-3 w-3 animate-spin" />
          ) : (
            <IconFileDiff className="h-3 w-3 text-amber-500" />
          )}
        </span>

        <IconFile className="h-3 w-3 shrink-0 text-muted-foreground/70" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {meta.filePath}
        </span>

        {stats && !isRunning && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {stats.added > 0 && (
              <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                +{stats.added}
              </span>
            )}
            {stats.removed > 0 && (
              <span className="text-[10px] font-semibold text-destructive">
                -{stats.removed}
              </span>
            )}
            {meta.truncated && (
              <span className="text-[10px] text-muted-foreground">
                (partial)
              </span>
            )}
          </span>
        )}

        {hasDiff && (
          <IconChevronDown
            className={cn(
              "ml-1 h-3 w-3 shrink-0 opacity-40",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>

      {/* Diff body */}
      <AnimatedCollapse open={expanded && hasDiff}>
        {hasDiff && (
          <div className="border-t border-border/40 bg-background">
            <DiffView lines={diff} maxLines={maxCollapsed} />
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
