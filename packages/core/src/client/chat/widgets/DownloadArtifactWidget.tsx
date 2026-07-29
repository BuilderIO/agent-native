import { IconDownload, IconFile } from "@tabler/icons-react";

import { agentNativePath } from "../../api-path.js";

export interface DownloadArtifactData {
  path: string;
  filename: string;
  url: string;
  sizeBytes: number;
  contentType: string;
  label?: string;
}

export function formatArtifactSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  return `${(kb / 1024).toFixed(kb / 1024 < 10 ? 1 : 0)} MB`;
}

export function normalizeArtifactData(
  value: unknown,
): DownloadArtifactData | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  const filename =
    typeof record.filename === "string" ? record.filename.trim() : "";
  if (!url || !filename) return null;
  return {
    path: typeof record.path === "string" ? record.path : filename,
    filename,
    url,
    sizeBytes: typeof record.sizeBytes === "number" ? record.sizeBytes : -1,
    contentType:
      typeof record.contentType === "string" ? record.contentType : "",
    ...(typeof record.label === "string" && record.label.trim()
      ? { label: record.label.trim() }
      : {}),
  };
}

export function DownloadArtifactWidget({
  artifact,
}: {
  artifact: DownloadArtifactData;
}) {
  const size = formatArtifactSize(artifact.sizeBytes);
  const meta = [size, artifact.contentType].filter(Boolean).join(" · ");

  return (
    <div className="my-1.5 flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-foreground shadow-sm">
      <IconFile className="h-5 w-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {artifact.label ?? artifact.filename}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {artifact.label
            ? `${artifact.filename}${meta ? ` · ${meta}` : ""}`
            : meta}
        </div>
      </div>
      <a
        href={agentNativePath(artifact.url)}
        download={artifact.filename}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        <IconDownload className="h-3.5 w-3.5" />
        Download
      </a>
    </div>
  );
}
