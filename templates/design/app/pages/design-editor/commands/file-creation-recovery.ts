import { callAction } from "@agent-native/core/client/hooks";
import { annotateScreenHtmlForPersist } from "@shared/screen-annotation";
import type { QueryClient } from "@tanstack/react-query";

import type { DesignFile } from "@/pages/design-editor/types";

import { designMetadataQueryKey } from "../design-query-key";

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

const designQueryKey = designMetadataQueryKey;

type FileMetadata = Pick<DesignFile, "id" | "filename" | "fileType">;
function cachedFileMetadata(
  queryClient: QueryClient,
  designId: string,
): FileMetadata[] | undefined {
  if (typeof queryClient.getQueryData !== "function") return undefined;
  const cached = queryClient.getQueryData<unknown>(designQueryKey(designId));
  if (!isRecord(cached) || !Array.isArray(cached.files)) return undefined;
  return cached.files.filter(
    (file: unknown): file is FileMetadata =>
      isRecord(file) &&
      typeof file.id === "string" &&
      typeof file.filename === "string" &&
      typeof file.fileType === "string",
  );
}

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

async function readDesignMetadata(designId: string): Promise<FileMetadata[]> {
  const result = await callAction<{ files: FileMetadata[] }>(
    "get-design",
    { id: designId, includeFileContent: false },
    { method: "GET" },
  );
  if (!Array.isArray(result.files))
    throw new Error("Design metadata was not returned");
  return result.files;
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
  const cached = cachedFileMetadata(queryClient, designId);
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

  const metadata = await readDesignMetadata(designId);
  const candidates = metadata.filter(
    (file) =>
      !beforeIds.has(file.id) &&
      file.filename === filename &&
      file.fileType === fileType,
  );
  for (const candidate of candidates) {
    const result = await callAction<{ files: DesignFile[] }>(
      "get-design",
      { id: designId, fileId: candidate.id },
      { method: "GET" },
    );
    const file = result.files.find((item) => item.id === candidate.id);
    if (file && matchesCreatedFile(file, expected)) return file;
  }
  return undefined;
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
  try {
    const refreshed = await readDesignMetadata(designId);
    return refreshed.some((file) => file.id === fileId);
  } catch {
    return undefined;
  }
}
