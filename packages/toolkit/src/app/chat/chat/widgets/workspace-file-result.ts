export interface WorkspaceFileResult {
  file: {
    resourceId: string;
    path: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    updatedAt?: string;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeWorkspaceFileResult(
  value: unknown,
): WorkspaceFileResult | null {
  if (!isRecord(value) || !isRecord(value.file)) return null;
  const file = value.file;
  if (
    typeof file.resourceId !== "string" ||
    !file.resourceId ||
    typeof file.path !== "string" ||
    !file.path ||
    typeof file.name !== "string" ||
    !file.name ||
    typeof file.contentType !== "string" ||
    !file.contentType ||
    typeof file.sizeBytes !== "number" ||
    !Number.isFinite(file.sizeBytes) ||
    file.sizeBytes < 0
  ) {
    return null;
  }

  return {
    file: {
      resourceId: file.resourceId,
      path: file.path,
      name: file.name,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      ...(typeof file.updatedAt === "string"
        ? { updatedAt: file.updatedAt }
        : {}),
    },
  };
}
