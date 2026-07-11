/**
 * FilesChangedSummary — aggregates all edit/write tool calls in a turn and
 * renders a compact "+N -M  path" summary row per file.  Click a row to expand
 * to that file's diff.  Derived purely from ContentPart structuredMeta.
 */

import { IconFiles } from "@tabler/icons-react";
import { memo, useMemo, useState } from "react";

import { AnimatedCollapse } from "../chat/tool-call-display.js";
import type { ContentPart } from "../sse-event-processor.js";
import { cn } from "../utils.js";
import { EditCell } from "./EditCell.js";
import { WriteCell } from "./WriteCell.js";

interface FilesChangedSummaryProps {
  /** All content parts in the current assistant turn. */
  parts: ContentPart[];
}

interface FileEntry {
  filePath: string;
  kind: "edit" | "write";
  added: number;
  removed: number;
  partIndex: number;
}

function countLines(text: string): number {
  return text ? text.split("\n").length : 0;
}

function editLineDelta(
  oldText: string | undefined,
  newText: string | undefined,
): { added: number; removed: number } {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  // Simple count: compare total lines per side.  For a real diff the
  // edit cell already shows the full diff, so this approximation is fine
  // for the summary bar.
  const base = Math.min(oldLines.length, newLines.length);
  const added = newLines.length - base;
  const removed = oldLines.length - base;
  return { added, removed };
}

function extractFileEntries(parts: ContentPart[]): FileEntry[] {
  const entries: FileEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type !== "tool-call" || !part.structuredMeta) continue;
    const meta = part.structuredMeta as Record<string, unknown>;
    const kind = meta.toolKind as string | undefined;
    if (kind === "edit") {
      const { added, removed } = editLineDelta(
        meta.oldText as string | undefined,
        meta.newText as string | undefined,
      );
      entries.push({
        filePath: (meta.filePath as string) ?? "",
        kind: "edit",
        added,
        removed,
        partIndex: i,
      });
    } else if (kind === "write") {
      const lineCount =
        typeof meta.lineCount === "number"
          ? meta.lineCount
          : countLines((meta.content as string | undefined) ?? "");
      entries.push({
        filePath: (meta.filePath as string) ?? "",
        kind: "write",
        added: lineCount,
        removed: 0,
        partIndex: i,
      });
    }
  }

  // Deduplicate: last edit/write per file path wins for the summary row,
  // but keep the expanded view as-is.
  const seen = new Map<string, number>();
  const deduped: FileEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.filePath}`;
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      deduped[existing] = entry;
    } else {
      seen.set(key, deduped.length);
      deduped.push(entry);
    }
  }
  return deduped;
}

export const FilesChangedSummary = memo(function FilesChangedSummary({
  parts,
}: FilesChangedSummaryProps) {
  const entries = useMemo(() => extractFileEntries(parts), [parts]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (entries.length === 0) return null;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalAdded = entries.reduce((s, e) => s + e.added, 0);
  const totalRemoved = entries.reduce((s, e) => s + e.removed, 0);

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/60">
      {/* Summary header */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
        <IconFiles className="h-3.5 w-3.5 shrink-0" />
        <span className="font-medium text-foreground">
          {entries.length} file{entries.length === 1 ? "" : "s"} changed
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {totalAdded > 0 && (
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              +{totalAdded}
            </span>
          )}
          {totalRemoved > 0 && (
            <span className="text-[10px] font-semibold text-destructive">
              -{totalRemoved}
            </span>
          )}
        </span>
      </div>

      {/* Per-file rows */}
      {entries.map((entry) => {
        const key = `${entry.kind}:${entry.filePath}`;
        const isExpanded = expanded.has(key);
        const part = parts[entry.partIndex];

        return (
          <div key={key} className="border-b border-border/30 last:border-b-0">
            <button
              type="button"
              onClick={() => toggle(key)}
              className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1 text-left text-[11px] hover:bg-accent"
            >
              <span
                className={cn(
                  "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
                  entry.kind === "write" ? "bg-emerald-500" : "bg-amber-500",
                )}
              />
              <span className="min-w-0 flex-1 truncate font-mono text-foreground">
                {entry.filePath}
              </span>
              <span className="ml-auto flex shrink-0 items-center gap-1">
                {entry.added > 0 && (
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    +{entry.added}
                  </span>
                )}
                {entry.removed > 0 && (
                  <span className="text-[10px] font-semibold text-destructive">
                    -{entry.removed}
                  </span>
                )}
              </span>
            </button>

            <AnimatedCollapse open={isExpanded}>
              {part.type === "tool-call" && part.structuredMeta && (
                <div className="pl-4">
                  {entry.kind === "edit" ? (
                    <EditCell
                      meta={
                        part.structuredMeta as unknown as Parameters<
                          typeof EditCell
                        >[0]["meta"]
                      }
                      isRunning={false}
                    />
                  ) : (
                    <WriteCell
                      meta={
                        part.structuredMeta as unknown as Parameters<
                          typeof WriteCell
                        >[0]["meta"]
                      }
                      isRunning={false}
                    />
                  )}
                </div>
              )}
            </AnimatedCollapse>
          </div>
        );
      })}
    </div>
  );
});
