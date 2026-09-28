import { annotateScreenHtmlForPersist } from "@shared/screen-annotation";
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

const designQueryKey = (designId: string) =>
  ["action", "get-design", { id: designId }] as const;

function cachedDesignFiles(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof designQueryKey>,
): DesignFile[] | undefined {
  if (typeof queryClient.getQueryData !== "function") return undefined;
  const cached = queryClient.getQueryData<unknown>(queryKey);
  if (!isRecord(cached) || !Array.isArray(cached.files)) return undefined;
  return cached.files.filter(isDesignFile);
}

function matchesCreatedFile(
  file: DesignFile,
  expected: Pick<DesignFile, "filename" | "fileType" | "content">,
): boolean {
  const persistedContent = annotateScreenHtmlForPersist(
    expected.content,
    expected.fileType,
  );
  return (
    file.filename === expected.filename &&
    file.fileType === expected.fileType &&
    (file.content === expected.content || file.content === persistedContent)
  );
}

async function refreshDesignFiles(
  queryClient: QueryClient,
  queryKey: ReturnType<typeof designQueryKey>,
): Promise<void> {
  if (typeof queryClient.refetchQueries === "function") {
    await queryClient.refetchQueries({ queryKey });
  } else {
    await queryClient.invalidateQueries({ queryKey });
  }
}

export function createdFileIdFromResult(result: unknown): string | undefined {
  const id = isRecord(result) && typeof result.id === "string" ? result.id : "";
  return id.trim().length > 0 ? id : undefined;
}

export function captureDesignFileIds({
  queryClient,
  designId,
  files,
}: {
  queryClient: QueryClient;
  designId: string;
  files: readonly DesignFile[];
}): Set<string> {
  const cached = cachedDesignFiles(queryClient, designQueryKey(designId));
  return new Set([
    ...files.map((file) => file.id),
    ...(cached ?? []).map((file) => file.id),
  ]);
}

export async function reconcileCreatedFile({
  queryClient,
  designId,
  filename,
  content,
  fileType,
  files,
  knownFileIds,
}: {
  queryClient: QueryClient;
  designId: string;
  filename: string;
  content: string;
  fileType: DesignFile["fileType"];
  files: readonly DesignFile[];
  knownFileIds?: ReadonlySet<string>;
}): Promise<DesignFile | undefined> {
  const queryKey = designQueryKey(designId);
  const expected = { filename, content, fileType };
  const cached = cachedDesignFiles(queryClient, queryKey);
  const beforeIds =
    knownFileIds ?? captureDesignFileIds({ queryClient, designId, files });
  const fromCurrent = (candidates: readonly DesignFile[]) =>
    candidates.find(
      (file) => !beforeIds.has(file.id) && matchesCreatedFile(file, expected),
    );
  const cachedFile = fromCurrent(cached ?? files);
  if (cachedFile) return cachedFile;

  await refreshDesignFiles(queryClient, queryKey);
  const refreshed = cachedDesignFiles(queryClient, queryKey);
  return refreshed ? fromCurrent(refreshed) : undefined;
}

export async function isPersistedFilePresent({
  queryClient,
  designId,
  fileId,
}: {
  queryClient: QueryClient;
  designId: string;
  fileId: string;
}): Promise<boolean | undefined> {
  const queryKey = designQueryKey(designId);
  await refreshDesignFiles(queryClient, queryKey);
  const refreshed = cachedDesignFiles(queryClient, queryKey);
  if (!refreshed) return undefined;
  return refreshed.some((file) => file.id === fileId);
}
