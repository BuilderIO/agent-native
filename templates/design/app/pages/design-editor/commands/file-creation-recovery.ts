import { callAction } from "@agent-native/core/client/hooks";
import { isFreeNameFor } from "@agent-native/core/free-name";
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
    isFreeNameFor(file.filename, expected.filename) &&
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

/**
 * The name create-file saved the file under. A create sent with
 * `ifNameTaken: "next-free"` can land under a free name near the one asked
 * for, when another tab or the agent took that name first.
 */
export function savedFilenameFromResult(
  result: unknown,
  requested: string,
): string {
  const filename =
    isRecord(result) && typeof result.filename === "string"
      ? result.filename
      : "";
  return filename.trim().length > 0 ? filename : requested;
}

/**
 * Whether a create that failed may still have saved its file. A 4xx answer is
 * the server refusing, so nothing was written. A dropped connection, a client
 * timeout (408) or a 5xx can come after the insert committed.
 */
export function createMayHaveSaved(error: unknown): boolean {
  const status = Number(isRecord(error) ? error.status : undefined);
  return !(status >= 400 && status < 500 && status !== 408);
}

/**
 * A duplicate's markup carries fresh random node ids, so a file with that
 * markup is this copy. Markup without node ids, such as a URL-backed screen's,
 * is the same in every copy of a screen, so it proves nothing on its own.
 */
export function contentIdentifiesCopy(content: string): boolean {
  return content.includes("data-agent-native-node-id=");
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
  const identifies = contentIdentifiesCopy(content);
  if (identifies) {
    const cachedFile = [...(cached ?? []), ...files].find(
      (file) => !beforeIds.has(file.id) && matchesCreatedFile(file, expected),
    );
    if (cachedFile) return cachedFile;
  }

  const metadata = await readDesignMetadata(designId);
  const candidates = metadata.filter(
    (file) =>
      !beforeIds.has(file.id) &&
      isFreeNameFor(file.filename, filename) &&
      file.fileType === fileType,
  );
  const matches: DesignFile[] = [];
  for (const candidate of candidates) {
    const result = await callAction<{ files: DesignFile[] }>(
      "get-design",
      { id: designId, fileId: candidate.id },
      { method: "GET" },
    );
    const file = result.files.find((item) => item.id === candidate.id);
    if (!file || !matchesCreatedFile(file, expected)) continue;
    if (identifies) return file;
    matches.push(file);
  }
  // Two new files with the same markup can't be told apart. Taking another
  // tab's copy as this one's would let this one's cleanup delete it.
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * The saved file with this id, null when the design no longer has it, or
 * undefined when that couldn't be checked.
 */
export async function findPersistedFile({
  designId,
  fileId,
}: {
  queryClient: QueryClient;
  designId: string;
  fileId: string;
}): Promise<FileMetadata | null | undefined> {
  try {
    const refreshed = await readDesignMetadata(designId);
    return refreshed.find((file) => file.id === fileId) ?? null;
  } catch (error) {
    console.error("Unable to verify recovered file presence", error);
    return undefined;
  }
}

export async function isPersistedFilePresent(args: {
  queryClient: QueryClient;
  designId: string;
  fileId: string;
}): Promise<boolean | undefined> {
  const file = await findPersistedFile(args);
  return file === undefined ? undefined : file !== null;
}
