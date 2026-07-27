export interface DesktopContentFilesFolder {
  id?: string;
  name: string;
  path?: string;
  sourcePrefix?: string;
  updatedAt?: string;
}

export interface DesktopContentFilesFolderRequest {
  folderId?: string;
}

export type DesktopContentFilesResult =
  | {
      ok: true;
      folder: DesktopContentFilesFolder;
      folders?: DesktopContentFilesFolder[];
      files?: string[];
      sources?: Record<string, string>;
      controlResources?: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
      canceled?: boolean;
      folder?: DesktopContentFilesFolder;
      folders?: DesktopContentFilesFolder[];
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
