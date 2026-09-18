/**
 * FilesChangedSummary — aggregates all edit/write tool calls in a turn and
 * renders a compact "path  +N -M" summary row per file.  Click a row to expand
 * to that file's diff.  Derived purely from ContentPart structuredMeta.
 */

import { memo, useMemo, useState } from "react";

import { AnimatedCollapse } from "../chat/tool-call-display.js";
import type { ContentPart } from "../sse-event-processor.js";
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

function splitFilePath(filePath: string): {
  directory: string;
  fileName: string;
} {
  const separator = filePath.lastIndexOf("/");
  return separator < 0
    ? { directory: "", fileName: filePath }
    : {
        directory: filePath.slice(0, separator + 1),
        fileName: filePath.slice(separator + 1),
      };
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

  return (
    <div data-agent-files-changed="" className="my-1 w-full">
      {entries.map((entry) => {
        const key = `${entry.kind}:${entry.filePath}`;
        const isExpanded = expanded.has(key);
        const part = parts[entry.partIndex];
        const { directory, fileName } = splitFilePath(entry.filePath);

        return (
          <div key={key}>
            <button
              data-agent-file-change-row=""
              type="button"
              onClick={() => toggle(key)}
              className="agent-kit-activity-row flex w-full min-w-0 cursor-pointer items-center gap-4 py-1 text-left text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-muted/50 focus-visible:outline-none"
            >
              <span
                data-agent-file-change-path=""
                className="min-w-0 flex-1 truncate"
                title={entry.filePath}
              >
                <span>{directory}</span>
                <span className="text-foreground">{fileName}</span>
              </span>
              <span
                data-agent-file-change-stats=""
                className="ms-auto flex shrink-0 items-center gap-1.5 tabular-nums"
              >
                <span className="agent-kit-tone-positive">+{entry.added}</span>
                <span className="text-destructive">−{entry.removed}</span>
              </span>
            </button>

            <AnimatedCollapse open={isExpanded}>
              {part.type === "tool-call" && part.structuredMeta && (
                <div>
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
