import {
  FileChange,
  FileChangeBody,
} from "../../agentkit/react/file-change.js";

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

export function WriteCell({
  meta,
  isRunning,
  defaultExpanded = false,
  hideHeader = false,
}: WriteCellProps) {
  const change = { ...meta, kind: "write" as const };
  if (hideHeader) return <FileChangeBody change={change} />;
  return (
    <FileChange
      className="my-1 w-full"
      change={change}
      running={isRunning}
      defaultOpen={defaultExpanded}
    />
  );
}
