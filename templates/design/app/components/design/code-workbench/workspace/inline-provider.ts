import { callAction } from "@agent-native/core/client";

import {
  WorkspaceStaleVersionError,
  type WorkspaceCapabilities,
  type WorkspaceFileEntry,
  type WorkspaceProvider,
  type WorkspaceReadResult,
  type WorkspaceWriteResult,
} from "./types";

/**
 * Workspace provider over the design's SQL-backed inline source files
 * (`designfs://<designId>/`), implemented against the existing agent-facing
 * source-workspace action surface: list-source-files, read-source-file,
 * preview-source-edit, apply-source-edit, create-file, update-file,
 * delete-file. This provider does not introduce any new backend surface —
 * it is a thin adapter so the workbench can treat inline files as one
 * `WorkspaceProvider` root alongside future localhost/remote roots.
 */

interface ListSourceFilesResponse {
  files: Array<{
    path: string;
    displayName?: string;
    fileId?: string;
    readonly?: boolean;
    language?: string;
  }>;
}

interface ReadSourceFileResponse {
  content: string;
  versionHash?: string;
  readonly?: boolean;
  language?: string;
  fileId?: string;
}

interface PreviewSourceEditResponse {
  okToApply: boolean;
  currentVersionHash?: string;
  message?: string;
}

interface ApplySourceEditResponse {
  versionHash?: string;
}

interface CreateFileResponse {
  id: string;
}

export interface CreateInlineProviderOptions {
  designId: string;
  canEdit: boolean;
}

export function createInlineProvider(
  options: CreateInlineProviderOptions,
): WorkspaceProvider {
  const { designId, canEdit } = options;
  const key = `inline:${designId}`;
  // path -> fileId, populated by listFiles and refreshed on demand so
  // renameFile/deleteFile can resolve a file's id without re-listing when
  // it is already known.
  const fileIdByPath = new Map<string, string>();

  const capabilities: WorkspaceCapabilities = {
    write: canEdit,
    create: canEdit,
    rename: canEdit,
    delete: canEdit,
  };

  async function listFiles(): Promise<WorkspaceFileEntry[]> {
    const response = await callAction<ListSourceFilesResponse>(
      "list-source-files",
      { designId },
      { method: "GET" },
    );
    const entries: WorkspaceFileEntry[] = response.files.map((file) => {
      if (file.fileId) fileIdByPath.set(file.path, file.fileId);
      return {
        path: file.path,
        displayName: file.displayName,
        fileId: file.fileId,
        readonly: file.readonly,
      };
    });
    return entries;
  }

  async function readFile(path: string): Promise<WorkspaceReadResult> {
    const response = await callAction<ReadSourceFileResponse>(
      "read-source-file",
      { designId, path },
      { method: "GET" },
    );
    if (response.fileId) fileIdByPath.set(path, response.fileId);
    return {
      content: response.content,
      versionHash: response.versionHash,
      readonly: response.readonly,
      language: response.language,
      fileId: response.fileId,
    };
  }

  /**
   * Persist content via the exact preview→apply chain used by the old
   * CodeWorkbenchHost.saveSelectedFile: preview first with a full-replace
   * edit; if the backend reports the file changed underneath us
   * (okToApply === false), throw WorkspaceStaleVersionError instead of
   * applying; otherwise apply using the preview's currentVersionHash (falling
   * back to the original expectedVersionHash) so a benign no-op preview
   * still chains through the same version the preview observed.
   */
  async function writeFile(
    path: string,
    content: string,
    expectedVersionHash?: string,
  ): Promise<WorkspaceWriteResult> {
    const edit = { kind: "full-replace" as const, content };
    const preview = await callAction<PreviewSourceEditResponse>(
      "preview-source-edit",
      { designId, path, expectedVersionHash, edit },
    );
    if (preview.okToApply === false) {
      throw new WorkspaceStaleVersionError(
        preview.message ||
          "Source file changed since it was read" /* i18n-ignore */,
      );
    }
    const result = await callAction<ApplySourceEditResponse>(
      "apply-source-edit",
      {
        designId,
        path,
        expectedVersionHash: preview.currentVersionHash ?? expectedVersionHash,
        edit,
      },
    );
    return { versionHash: result.versionHash };
  }

  async function createFile(path: string, content: string): Promise<void> {
    const response = await callAction<CreateFileResponse>("create-file", {
      designId,
      filename: path,
      content,
      fileType: "html",
    });
    if (response.id) fileIdByPath.set(path, response.id);
  }

  async function resolveFileId(path: string): Promise<string> {
    const cached = fileIdByPath.get(path);
    if (cached) return cached;
    // Refresh from the server once before giving up — the cache may be cold
    // (e.g. a fresh provider instance that never called listFiles for this
    // path yet).
    await listFiles();
    const refreshed = fileIdByPath.get(path);
    if (!refreshed) {
      throw new Error(`Could not resolve file id for "${path}"`);
    }
    return refreshed;
  }

  async function renameFile(path: string, nextPath: string): Promise<void> {
    const id = await resolveFileId(path);
    await callAction("update-file", { id, filename: nextPath });
    fileIdByPath.delete(path);
    fileIdByPath.set(nextPath, id);
  }

  async function deleteFile(path: string): Promise<void> {
    const id = await resolveFileId(path);
    await callAction("delete-file", { id });
    fileIdByPath.delete(path);
  }

  return {
    key,
    kind: "inline",
    label: "Design files" /* i18n-ignore */,
    capabilities,
    listFiles,
    readFile,
    writeFile,
    createFile,
    renameFile,
    deleteFile,
  };
}
