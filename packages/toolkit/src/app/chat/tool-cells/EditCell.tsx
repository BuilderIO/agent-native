import { useT } from "@agent-native/core/client/i18n";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconChevronDown,
  IconFileDiff,
  IconLoader2,
} from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";

import { AnimatedCollapse } from "../chat/tool-call-display.js";

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
  defaultExpanded?: boolean;
  /** Render only the diff, for hosts that already show the path. */
  hideHeader?: boolean;
}

const MAX_COLLAPSED_LINES = 40;
const TOOL_CELL_ROW_CLASS =
  "agent-kit-activity-row flex w-full min-w-0 items-center gap-2 py-1 text-start text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-muted/50 focus-visible:outline-none";

interface DiffLine {
  kind: "context" | "added" | "removed";
  text: string;
  oldLineNo?: number;
  newLineNo?: number;
}

function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const MAX_LINES = 2000;
  const a = oldLines.slice(0, MAX_LINES);
  const b = newLines.slice(0, MAX_LINES);

  const m = a.length;
  const n = b.length;

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

function diffStats(lines: DiffLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "added") added++;
    else if (line.kind === "removed") removed++;
  }
  return { added, removed };
}

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
                  "bg-[hsl(var(--agent-kit-positive)/0.08)]",
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
                  line.kind === "added" && "agent-kit-tone-positive",
                  line.kind === "removed" && "text-destructive",
                  line.kind === "context" && "text-muted-foreground/40",
                )}
              >
                {line.kind === "added"
                  ? "+"
                  : line.kind === "removed"
                    ? "\u2212"
                    : " "}
              </td>
              {/* Content */}
              <td className="px-2 text-foreground">
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

export function EditCell({
  meta,
  isRunning,
  defaultExpanded = false,
  hideHeader = false,
}: EditCellProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(defaultExpanded);
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

  const body = hasDiff ? (
    <div className="mt-1 overflow-hidden rounded-md border border-border/60 bg-background">
      <DiffView lines={diff} maxLines={maxCollapsed} />
      {hiddenLines > 0 && (
        <div className="border-t border-border/40 px-3 py-1 text-xs text-muted-foreground">
          <button
            type="button"
            className="cursor-pointer underline hover:text-foreground"
            onClick={() => setShowAll(true)}
          >
            {t("agentChat.toolCells.showMoreLines", { count: hiddenLines })}
          </button>
        </div>
      )}
    </div>
  ) : null;

  if (hideHeader) return <div className="my-1 w-full">{body}</div>;

  return (
    <div className="my-1 w-full">
      <button
        type="button"
        onClick={() => hasDiff && setExpanded((e) => !e)}
        className={cn(
          TOOL_CELL_ROW_CLASS,
          hasDiff ? "cursor-pointer" : "cursor-default",
        )}
        aria-expanded={hasDiff ? expanded : undefined}
      >
        <span className="flex shrink-0">
          {isRunning ? (
            <IconLoader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <IconFileDiff className="size-4 text-muted-foreground/70" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-foreground">
          {meta.filePath}
        </span>

        {stats && !isRunning && (
          <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
            {stats.added > 0 && (
              <span className="agent-kit-tone-positive">+{stats.added}</span>
            )}
            {stats.removed > 0 && (
              <span className="text-destructive">
                {"\u2212"}
                {stats.removed}
              </span>
            )}
            {meta.truncated && <span>{t("agentChat.toolCells.partial")}</span>}
          </span>
        )}

        {hasDiff && (
          <IconChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 opacity-60 transition-transform duration-150 motion-reduce:transition-none",
              expanded && "rotate-180",
            )}
          />
        )}
      </button>

      <AnimatedCollapse open={expanded && hasDiff}>{body}</AnimatedCollapse>
    </div>
  );
}
