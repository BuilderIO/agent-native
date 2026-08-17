export interface DesktopContentFilesFolder {
  id?: string;
  name: string;
  kind?: "persistent" | "temporary";
  repository?: {
    localId: string;
    branch?: string;
    commit?: string;
    detached?: boolean;
  };
  sourcePrefix?: string;
  updatedAt?: string;
}

export interface DesktopContentFilesFolderRequest {
  folderId?: string;
}

/** Opaque content fingerprint returned by the trusted local bridge. */
export type DesktopContentFileRevision = string;

export interface DesktopContentFileConflict {
  path: string;
  expectedRevision?: string;
  actualRevision?: string;
}

export type DesktopContentFilesChange = {
  folderId: string;
  revision: string;
  changedAt: string;
  missing?: boolean;
  reason?: "attached" | "changed" | "missing";
};

export type DesktopContentFilesWatchResult =
  | { ok: true; unsubscribe(): void }
  | { ok: false; error: string; unavailable?: boolean };

export type DesktopContentFilesResult =
  | {
      ok: true;
      folder: DesktopContentFilesFolder;
      folders?: DesktopContentFilesFolder[];
      files?: string[];
      sources?: Record<string, string>;
      revisions?: Record<string, DesktopContentFileRevision>;
      controlResources?: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
      canceled?: boolean;
      folder?: DesktopContentFilesFolder;
      folders?: DesktopContentFilesFolder[];
      code?: "conflict" | "unavailable" | "invalid-request";
      conflict?: DesktopContentFileConflict;
    };

export interface DesktopContentFilesApi {
  getFolder(
    request?: DesktopContentFilesFolderRequest,
  ): Promise<DesktopContentFilesResult>;
  chooseFolder(): Promise<DesktopContentFilesResult>;
  writeFiles(request: {
    folderId?: string;
    files: Record<string, string>;
  }): Promise<DesktopContentFilesResult>;
  writeFile(request: {
    folderId?: string;
    path: string;
    content: string;
    /** The revision observed by the editor; a mismatch must not overwrite. */
    expectedRevision?: string;
  }): Promise<DesktopContentFilesResult>;
  deleteFile?(request: {
    folderId?: string;
    path: string;
  }): Promise<DesktopContentFilesResult>;
  readFiles(
    request?: DesktopContentFilesFolderRequest,
  ): Promise<DesktopContentFilesResult>;
  revealFile(request: {
    folderId?: string;
    path: string;
  }): Promise<DesktopContentFilesResult>;
  clearFolder(
    request?: DesktopContentFilesFolderRequest,
  ): Promise<DesktopContentFilesResult>;
  subscribeChanges?(
    request: DesktopContentFilesFolderRequest,
  ): Promise<DesktopContentFilesResult>;
  unsubscribeChanges?(
    request: DesktopContentFilesFolderRequest,
  ): Promise<DesktopContentFilesResult>;
  onChange?(callback: (change: DesktopContentFilesChange) => void): () => void;
  /** Optional until the installed Desktop bridge supports live folder events. */
  watchFiles?(
    request: DesktopContentFilesFolderRequest,
    onChange: (change: DesktopContentFilesChange) => void,
  ): Promise<DesktopContentFilesWatchResult>;
}

type WindowWithAgentNativeDesktop = Window & {
  agentNativeDesktop?: {
    contentFiles?: DesktopContentFilesApi;
  };
};

export function getDesktopContentFiles(): DesktopContentFilesApi | null {
  if (typeof window === "undefined") return null;
  return (
    (window as WindowWithAgentNativeDesktop).agentNativeDesktop?.contentFiles ??
    null
  );
}
