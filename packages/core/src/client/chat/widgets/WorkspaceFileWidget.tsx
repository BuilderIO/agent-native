import {
  IconDownload,
  IconFile,
  IconFileSpreadsheet,
  IconFileText,
} from "@tabler/icons-react";

import { useFormatters, useT } from "../../i18n.js";
import { resourceDownloadUrl } from "../../resources/use-resources.js";
import type { WorkspaceFileResult } from "./workspace-file-result.js";

function formatFileSize(
  sizeBytes: number,
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string,
): string {
  if (sizeBytes < 1024) return `${formatNumber(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) {
    return `${formatNumber(sizeBytes / 1024, { maximumFractionDigits: 1 })} KB`;
  }
  return `${formatNumber(sizeBytes / 1024 / 1024, {
    maximumFractionDigits: 1,
  })} MB`;
}

function fileIcon(contentType: string) {
  if (
    contentType === "text/csv" ||
    contentType.includes("spreadsheet") ||
    contentType.includes("excel")
  ) {
    return IconFileSpreadsheet;
  }
  if (contentType.startsWith("text/") || contentType === "application/json") {
    return IconFileText;
  }
  return IconFile;
}

export function WorkspaceFileWidget({
  result,
}: {
  result: WorkspaceFileResult;
}) {
  const t = useT();
  const { formatNumber } = useFormatters();
  const { file } = result;
  const FileIcon = fileIcon(file.contentType);
  const href = resourceDownloadUrl(file.resourceId);

  return (
    <div className="flex items-center gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <FileIcon className="size-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{file.name}</div>
        <div className="truncate text-xs text-muted-foreground">
          {formatFileSize(file.sizeBytes, formatNumber)} · {file.path}
        </div>
      </div>
      <a
        href={href}
        download={file.name}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground no-underline transition-colors hover:bg-primary/90 hover:no-underline"
      >
        <IconDownload className="size-3.5" aria-hidden="true" />
        {t("workspaceFile.download")}
      </a>
    </div>
  );
}
