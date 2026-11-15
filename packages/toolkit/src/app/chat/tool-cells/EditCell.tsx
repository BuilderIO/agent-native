import {
  FileChange,
  FileChangeBody,
} from "../../agentkit/react/file-change.js";

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

export function EditCell({
  meta,
  isRunning,
  defaultExpanded = false,
  hideHeader = false,
}: EditCellProps) {
  const change = { ...meta, kind: "edit" as const };
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
