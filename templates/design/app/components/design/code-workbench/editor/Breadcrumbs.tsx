import { IconChevronRight } from "@tabler/icons-react";

import { FileIcon } from "../explorer/file-icons";
import { useWorkbench } from "../store";
import { parseWorkbenchUri } from "../workspace/types";

export function Breadcrumbs() {
  const { state } = useWorkbench();
  if (!state.activeUri) return null;
  const { path } = parseWorkbenchUri(state.activeUri);
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const fileName = segments[segments.length - 1];
  const folderSegments = segments.slice(0, -1);

  return (
    <div
      data-testid="workbench-breadcrumbs"
      className="flex h-6 shrink-0 items-center gap-1 overflow-hidden border-b border-[var(--workbench-border)] px-3 text-[11px] text-[var(--workbench-breadcrumb-fg)]"
    >
      {folderSegments.map((segment, index) => (
        <span
          key={`${segment}-${index}`}
          className="flex shrink-0 items-center gap-1"
        >
          <span className="truncate">{segment}</span>
          <IconChevronRight className="size-3 shrink-0 opacity-60" />
        </span>
      ))}
      <span className="flex min-w-0 items-center gap-1">
        <FileIcon path={fileName} />
        <span className="truncate text-[var(--workbench-fg)]">{fileName}</span>
      </span>
    </div>
  );
}
