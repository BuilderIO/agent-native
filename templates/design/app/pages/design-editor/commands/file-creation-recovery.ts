import type { QueryClient } from "@tanstack/react-query";

import type { DesignFile } from "@/pages/design-editor/types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isDesignFile(value: unknown): value is DesignFile {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.filename === "string" &&
    typeof value.content === "string" &&
    typeof value.fileType === "string"
  );
}

export function createdFileIdFromResult(result: unknown): string | undefined {
  const id = isRecord(result) && typeof result.id === "string" ? result.id : "";
  return id.trim().length > 0 ? id : undefined;
}

export async function reconcileCreatedFile({
  queryClient,
  designId,
  filename,
  files,
}: {
  queryClient: QueryClient;
  designId: string;
  filename: string;
  files: readonly DesignFile[];
}): Promise<DesignFile | undefined> {
  const queryKey = ["action", "get-design", { id: designId }] as const;
  const find = () => {
    const cached = queryClient.getQueryData<unknown>(queryKey);
    const cachedFiles =
      isRecord(cached) && Array.isArray(cached.files) ? cached.files : [];
    return [...cachedFiles, ...files].find(
      (file) => isDesignFile(file) && file.filename === filename,
    ) as DesignFile | undefined;
  };
  const cachedFile = find();
  if (cachedFile) return cachedFile;
  await queryClient.invalidateQueries({ queryKey });
  return find();
}
