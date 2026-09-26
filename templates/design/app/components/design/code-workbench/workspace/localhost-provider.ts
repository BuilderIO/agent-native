import { callAction } from "@agent-native/core/client/hooks";

import {
  WorkspaceStaleVersionError,
  type WorkspaceCapabilities,
  type WorkspaceFileEntry,
  type WorkspaceProvider,
  type WorkspaceReadResult,
  type WorkspaceWriteResult,
} from "./types";


export class LocalWriteConsentRequiredError extends Error {
  connectionId: string;
  path?: string;

  constructor(connectionId: string, path?: string, message?: string) {
    super(
      message ??
        "Local write consent is required before saving this file" /* i18n-ignore */,
    );
    this.name = "LocalWriteConsentRequiredError";
    this.connectionId = connectionId;
    this.path = path;
  }
}

interface ListLocalFilesResponse {
  files: Array<{ path: string; size: number }>;
  truncated: boolean;
}

interface ReadLocalFileResponse {
  content: string;
  versionHash?: string;
  readonly?: boolean;
}

interface WriteLocalFileResponse {
  written: boolean;
  versionHash?: string;
}

const LOCAL_READ_TIMEOUT_MS = 15_000;

export class LocalWorkspaceTimeoutError extends Error {
  constructor(operation: "list" | "read") {
    super(
      operation === "list"
        ? "Local files took too long to load. Check the local connection and try again." /* i18n-ignore */
        : "This local file took too long to load. Check the local connection and try again." /* i18n-ignore */,
    );
    this.name = "LocalWorkspaceTimeoutError";
  }
}

export async function withLocalReadTimeout<T>(
  operation: "list" | "read",
  request: Promise<T>,
  timeoutMs = LOCAL_READ_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new LocalWorkspaceTimeoutError(operation)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isWriteConsentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /write-consent grant/i.test(error.message) ||
    /grant expired/i.test(error.message)
  );
}

function isVersionConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /version conflict/i.test(error.message);
}

export interface CreateLocalhostProviderOptions {
  connectionId: string;
  label: string;
  rootPath?: string;
  canEdit: boolean;
  designId: string;
}

export function createLocalhostProvider(
  options: CreateLocalhostProviderOptions,
): WorkspaceProvider {
  const { connectionId, label, rootPath, canEdit, designId } = options;
  const key = `localhost:${connectionId}`;

  const capabilities: WorkspaceCapabilities = {
    write: canEdit,
    create: false,
    rename: false,
    delete: false,
  };

  async function listFiles(): Promise<WorkspaceFileEntry[]> {
    const response = await withLocalReadTimeout(
      "list",
      callAction<ListLocalFilesResponse>(
        "list-local-files",
        { designId, connectionId },
        { method: "GET" },
      ),
    );
    return response.files.map((file) => ({
      path: file.path,
      size: file.size,
      readonly: !canEdit,
    }));
  }

  async function readFile(path: string): Promise<WorkspaceReadResult> {
    const response = await withLocalReadTimeout(
      "read",
      callAction<ReadLocalFileResponse>(
        "read-local-file",
        { designId, connectionId, path },
        { method: "GET" },
      ),
    );
    return {
      content: response.content,
      versionHash: response.versionHash,
      readonly: response.readonly ?? !canEdit,
    };
  }

  async function writeFile(
    path: string,
    content: string,
    expectedVersionHash?: string,
  ): Promise<WorkspaceWriteResult> {
    try {
      const response = await callAction<WriteLocalFileResponse>(
        "write-local-file",
        {
          designId,
          connectionId,
          relPath: path,
          content,
          expectedVersionHash,
        },
      );
      return { versionHash: response.versionHash };
    } catch (error) {
      if (isVersionConflictError(error)) {
        throw new WorkspaceStaleVersionError(
          error instanceof Error
            ? error.message
            : "File changed on disk since it was last read" /* i18n-ignore */,
        );
      }
      if (isWriteConsentError(error)) {
        throw new LocalWriteConsentRequiredError(
          connectionId,
          path,
          error instanceof Error ? error.message : undefined,
        );
      }
      throw error;
    }
  }

  return {
    key,
    kind: "localhost",
    label,
    rootPath,
    capabilities,
    listFiles,
    readFile,
    writeFile,
  };
}
