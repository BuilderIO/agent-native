export interface DesktopContentFilesFolder {
  name: string;
  updatedAt?: string;
}

export type DesktopContentFilesResult =
  | {
      ok: true;
      folder: DesktopContentFilesFolder;
      files?: string[];
      sources?: Record<string, string>;
    }
  | {
      ok: false;
      error: string;
      canceled?: boolean;
      folder?: DesktopContentFilesFolder;
    };

export interface DesktopContentFilesApi {
  getFolder(): Promise<DesktopContentFilesResult>;
  chooseFolder(): Promise<DesktopContentFilesResult>;
  writeFiles(request: {
    files: Record<string, string>;
  }): Promise<DesktopContentFilesResult>;
  readFiles(): Promise<DesktopContentFilesResult>;
  clearFolder(): Promise<DesktopContentFilesResult>;
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
