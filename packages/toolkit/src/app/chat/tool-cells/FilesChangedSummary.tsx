import type { ContentPart } from "@agent-native/core/client/agent-chat";
import { memo, useMemo } from "react";

import {
  FileChange,
  type FileChangeData,
} from "../../agentkit/react/file-change.js";
import { Trace } from "../../agentkit/react/trace.js";

interface FilesChangedSummaryProps {
  parts: ContentPart[];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Each file's latest edit and latest write, in the order first touched. */
function extractFileEntries(parts: ContentPart[]): FileChangeData[] {
  const entries = new Map<string, FileChangeData>();
  for (const part of parts) {
    if (part.type !== "tool-call" || !part.structuredMeta) continue;
    const meta = part.structuredMeta as Record<string, unknown>;
    const kind = meta.toolKind;
    if (kind !== "edit" && kind !== "write") continue;
    const filePath = text(meta.filePath) ?? "";
    entries.set(`${kind}:${filePath}`, {
      filePath,
      kind,
      oldText: text(meta.oldText),
      newText: text(meta.newText),
      content: text(meta.content),
      lineCount:
        typeof meta.lineCount === "number" ? meta.lineCount : undefined,
      truncated: meta.truncated === true,
    });
  }
  return [...entries.values()];
}

export const FilesChangedSummary = memo(function FilesChangedSummary({
  parts,
}: FilesChangedSummaryProps) {
  const entries = useMemo(() => extractFileEntries(parts), [parts]);
  if (entries.length === 0) return null;
  return (
    <Trace data-agent-files-changed="" className="agentkit-files-changed my-1">
      {entries.map((entry) => (
        <FileChange key={`${entry.kind}:${entry.filePath}`} change={entry} />
      ))}
    </Trace>
  );
});
