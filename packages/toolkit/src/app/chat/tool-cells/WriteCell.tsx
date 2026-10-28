import { useT } from "@agent-native/core/client/i18n";
import { cn } from "@agent-native/toolkit/utils";
import {
  IconChevronDown,
  IconFilePlus,
  IconLoader2,
} from "@tabler/icons-react";
import { memo, useState } from "react";

import { AnimatedCollapse } from "../chat/tool-call-display.js";

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
  defaultExpanded?: boolean;
  /** Render only the file body, for hosts that already show the path. */
  hideHeader?: boolean;
}

const MAX_COLLAPSED_LINES = 40;
const TOOL_CELL_ROW_CLASS =
  "agent-kit-activity-row flex w-full min-w-0 items-center gap-2 py-1 text-start text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-muted/50 focus-visible:outline-none";

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
            <tr key={idx} className="bg-[hsl(var(--agent-kit-positive)/0.08)]">
              <td className="w-8 select-none border-r border-border/30 px-1.5 text-right text-[10px] text-muted-foreground/60">
                {idx + 1}
              </td>
              <td className="agent-kit-tone-positive w-4 select-none text-center text-[10px] font-bold">
                +
              </td>
              <td className="px-2 text-foreground">
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

export function WriteCell({
  meta,
  isRunning,
  defaultExpanded = false,
  hideHeader = false,
}: WriteCellProps) {
  const t = useT();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAll, setShowAll] = useState(false);

  const hasContent = Boolean(meta.content);
  const lines = meta.content ? meta.content.split("\n") : [];
  const totalLines = lines.length;
  const maxCollapsed =
    showAll || totalLines <= MAX_COLLAPSED_LINES ? null : MAX_COLLAPSED_LINES;
  const hiddenLines =
    maxCollapsed !== null ? totalLines - MAX_COLLAPSED_LINES : 0;

  const body = meta.content ? (
    <div className="mt-1 overflow-hidden rounded-md border border-border/60 bg-background">
      <FileContentView content={meta.content} maxLines={maxCollapsed} />
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
        onClick={() => hasContent && setExpanded((e) => !e)}
        className={cn(
          TOOL_CELL_ROW_CLASS,
          hasContent ? "cursor-pointer" : "cursor-default",
        )}
        aria-expanded={hasContent ? expanded : undefined}
      >
        <span className="flex shrink-0">
          {isRunning ? (
            <IconLoader2 className="size-4 animate-spin motion-reduce:animate-none" />
          ) : (
            <IconFilePlus className="agent-kit-tone-positive size-4" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-foreground">
          {meta.filePath}
        </span>

        <span className="ms-auto flex shrink-0 items-center gap-1.5 text-xs tabular-nums">
          {meta.lineCount !== undefined && !isRunning && (
            <span className="agent-kit-tone-positive">+{meta.lineCount}</span>
          )}
          {meta.truncated && <span>{t("agentChat.toolCells.partial")}</span>}
          {hasContent && (
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

      <AnimatedCollapse open={expanded && hasContent}>{body}</AnimatedCollapse>
    </div>
  );
}
