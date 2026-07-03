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
 * Workspace provider over a connected local app's real files, via the
 * localhost design bridge (list-local-files, read-local-file,
 * write-local-file actions -> packages/core design-connect bridge).
 *
 * Reads require only editor access + a valid bridge connection. Writes
 * additionally require a user-approved write-consent grant (verified
 * server-side by write-local-file / verifyWriteGrant); a missing or expired
 * grant surfaces here as LocalWriteConsentRequiredError so the UI can run the
 * existing LocalhostWriteConsentDialog flow and retry.
 */

export class LocalWriteConsentRequiredError extends Error {
  connectionId: string;
  /** The relative path the consent dialog should show/scope to, when known. */
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

/** Detect the write-local-file action's grant-related error messages. */
function isWriteConsentError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    /write-consent grant/i.test(error.message) ||
    /grant expired/i.test(error.message)
  );
}

/** Detect the bridge's version-conflict error message (see design-connect.ts). */
function isVersionConflictError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /version conflict/i.test(error.message);
}

export interface CreateLocalhostProviderOptions {
  connectionId: string;
  label: string;
  /**
   * Whether the current user has editor access to the design. Local files are
   * editable whenever this is true — the write-consent grant is enforced
   * server-side at save time, and a missing grant surfaces as
   * LocalWriteConsentRequiredError so the shell can run the consent dialog and
   * retry the save.
   */
  canEdit: boolean;
  /**
   * The owning design's id. write-local-file requires {designId,
   * connectionId, relPath, content} — designId is not optional server-side
   * (verifyWriteGrant looks up the grant by designId + connectionId +
   * ownerEmail).
   */
  designId: string;
}

export function createLocalhostProvider(
  options: CreateLocalhostProviderOptions,
): WorkspaceProvider {
  const { connectionId, label, canEdit, designId } = options;
  const key = `localhost:${connectionId}`;

  const capabilities: WorkspaceCapabilities = {
    write: canEdit,
    create: false,
    rename: false,
    delete: false,
  };

  async function listFiles(): Promise<WorkspaceFileEntry[]> {
    const response = await callAction<ListLocalFilesResponse>(
      "list-local-files",
      { designId, connectionId },
      { method: "GET" },
    );
    return response.files.map((file) => ({
      path: file.path,
      size: file.size,
      readonly: !canEdit,
    }));
  }

  async function readFile(path: string): Promise<WorkspaceReadResult> {
    const response = await callAction<ReadLocalFileResponse>(
      "read-local-file",
      { designId, connectionId, path },
      { method: "GET" },
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
    // write-local-file's schema uses relPath (not path) and a bare content
    // field (not a {mode} wrapper) — see templates/design/actions/write-local-file.ts.
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
    capabilities,
    listFiles,
    readFile,
    writeFile,
  };
}
