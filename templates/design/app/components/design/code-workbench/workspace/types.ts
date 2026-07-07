/**
 * Workspace provider contract for the code workbench.
 *
 * A provider is one workspace root in the explorer: the design's SQL-backed
 * files (`inline`) or a connected local app's real files (`localhost`).
 * Future remote-container sources become additional providers implementing
 * this same interface.
 */

export type WorkspaceRootKind = "inline" | "localhost";

export interface WorkspaceCapabilities {
  write: boolean;
  create: boolean;
  rename: boolean;
  delete: boolean;
}

export interface WorkspaceFileEntry {
  /** Root-relative path, `/`-separated, no leading slash. */
  path: string;
  displayName?: string;
  fileId?: string;
  readonly?: boolean;
  size?: number;
}

export interface WorkspaceReadResult {
  content: string;
  versionHash?: string;
  readonly?: boolean;
  language?: string;
  fileId?: string;
}

export interface WorkspaceWriteResult {
  versionHash?: string;
}

export interface WorkspaceProvider {
  /** Stable key: `inline:<designId>` or `localhost:<connectionId>`. */
  key: string;
  kind: WorkspaceRootKind;
  /** Explorer section label, e.g. "Design files" or the local app name. */
  label: string;
  capabilities: WorkspaceCapabilities;
  listFiles(): Promise<WorkspaceFileEntry[]>;
  readFile(path: string): Promise<WorkspaceReadResult>;
  /**
   * Persist content. Implementations own their concurrency story (the inline
   * provider chains preview-source-edit → apply-source-edit with version
   * hashes). Throws on failure; throws WorkspaceStaleVersionError when the
   * file changed underneath the caller.
   */
  writeFile(
    path: string,
    content: string,
    expectedVersionHash?: string,
  ): Promise<WorkspaceWriteResult>;
  createFile?(path: string, content: string): Promise<void>;
  renameFile?(path: string, nextPath: string): Promise<void>;
  deleteFile?(path: string): Promise<void>;
}

export class WorkspaceStaleVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceStaleVersionError";
  }
}

const URI_SEPARATOR = "::";

/** Workbench-internal uri: `<providerKey>::<path>`. */
export function workbenchUri(providerKey: string, path: string): string {
  return `${providerKey}${URI_SEPARATOR}${path.replace(/^\/+/, "")}`;
}

export function parseWorkbenchUri(uri: string): {
  providerKey: string;
  path: string;
} {
  const index = uri.indexOf(URI_SEPARATOR);
  if (index < 0) return { providerKey: "", path: uri };
  return {
    providerKey: uri.slice(0, index),
    path: uri.slice(index + URI_SEPARATOR.length),
  };
}

export function providerKindFromKey(providerKey: string): WorkspaceRootKind {
  return providerKey.startsWith("localhost:") ? "localhost" : "inline";
}

export function baseName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

export function dirName(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.slice(0, -1).join("/");
}
