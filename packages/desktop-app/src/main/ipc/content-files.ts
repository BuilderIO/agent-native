import {
  IPC,
  type DesktopContentFileDeleteRequest,
  type DesktopContentFileRevealRequest,
  type DesktopContentFileWriteRequest,
  type DesktopContentFilesClearFolderRequest,
  type DesktopContentFilesFolder,
  type DesktopContentFilesFolderRequest,
  type DesktopContentFilesResult,
  type DesktopContentFilesWriteRequest,
} from "@shared/ipc-channels";
import { ipcMain, type IpcMainInvokeEvent } from "electron";

import type { ContentFilesGrant } from "../index";

export interface ContentFilesIpcDeps {
  /** Rejects requests that don't come from the Content app's own webview. */
  requireContentFilesWebviewAccess: (
    event: IpcMainInvokeEvent,
  ) => DesktopContentFilesResult | null;
  getContentFilesGrants: () => ContentFilesGrant[];
  getContentFilesGrant: (folderId?: string) => ContentFilesGrant | null;
  contentFilesFolderInfo: (
    grant: ContentFilesGrant,
  ) => DesktopContentFilesFolder;
  contentFilesFoldersInfo: (
    grants?: ContentFilesGrant[],
  ) => DesktopContentFilesFolder[];
  chooseContentFilesFolder: () => Promise<DesktopContentFilesResult>;
  writeContentFilesForRequest: (
    request: DesktopContentFilesWriteRequest,
  ) => Promise<DesktopContentFilesResult>;
  writeContentFileForRequest: (
    request: DesktopContentFileWriteRequest,
  ) => Promise<DesktopContentFilesResult>;
  deleteContentFileForRequest: (
    request: DesktopContentFileDeleteRequest,
  ) => Promise<DesktopContentFilesResult>;
  readContentFilesForRequest: (
    request: DesktopContentFilesFolderRequest,
  ) => Promise<DesktopContentFilesResult>;
  revealContentFileForRequest: (
    request: DesktopContentFileRevealRequest,
  ) => Promise<DesktopContentFilesResult>;
  clearContentFilesGrant: (folderId?: string) => DesktopContentFilesResult;
}

/**
 * Registers the Content-app local-folder sync IPC handlers (get/choose/write/
 * write-file/delete-file/read/reveal-file/clear). All access is gated to the
 * Content app's own webview via `requireContentFilesWebviewAccess`.
 */
export function registerContentFilesIpc(deps: ContentFilesIpcDeps): void {
  const {
    requireContentFilesWebviewAccess,
    getContentFilesGrants,
    getContentFilesGrant,
    contentFilesFolderInfo,
    contentFilesFoldersInfo,
    chooseContentFilesFolder,
    writeContentFilesForRequest,
    writeContentFileForRequest,
    deleteContentFileForRequest,
    readContentFilesForRequest,
    revealContentFileForRequest,
    clearContentFilesGrant,
  } = deps;

  ipcMain.handle(
    IPC.CONTENT_FILES_GET_FOLDER,
    async (
      event: IpcMainInvokeEvent,
      request: DesktopContentFilesFolderRequest = {},
    ): Promise<DesktopContentFilesResult> => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return denied;
      const grants = getContentFilesGrants();
      const grant = getContentFilesGrant(request.folderId);
      if (!grant) return { ok: false, error: "No local folder is linked." };
      return {
        ok: true,
        folder: contentFilesFolderInfo(grant),
        folders: contentFilesFoldersInfo(grants),
      };
    },
  );

  ipcMain.handle(
    IPC.CONTENT_FILES_CHOOSE_FOLDER,
    (event: IpcMainInvokeEvent): Promise<DesktopContentFilesResult> => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return chooseContentFilesFolder();
    },
  );

  ipcMain.handle(
    IPC.CONTENT_FILES_WRITE,
    (
      event: IpcMainInvokeEvent,
      request: DesktopContentFilesWriteRequest,
    ): Promise<DesktopContentFilesResult> => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return writeContentFilesForRequest(request);
    },
  );

  ipcMain.handle(
    IPC.CONTENT_FILES_WRITE_FILE,
    (
      event: IpcMainInvokeEvent,
      request: DesktopContentFileWriteRequest,
    ): Promise<DesktopContentFilesResult> => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return writeContentFileForRequest(request);
    },
  );

  ipcMain.handle(
    IPC.CONTENT_FILES_DELETE_FILE,
    (
      event: IpcMainInvokeEvent,
      request: DesktopContentFileDeleteRequest,
    ): Promise<DesktopContentFilesResult> => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return deleteContentFileForRequest(request);
    },
  );

  ipcMain.handle(
    IPC.CONTENT_FILES_READ,
    (
      event: IpcMainInvokeEvent,
      request: DesktopContentFilesFolderRequest = {},
    ): Promise<DesktopContentFilesResult> => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return readContentFilesForRequest(request);
    },
  );

  ipcMain.handle(
    IPC.CONTENT_FILES_REVEAL_FILE,
    (
      event: IpcMainInvokeEvent,
      request: DesktopContentFileRevealRequest,
    ): Promise<DesktopContentFilesResult> => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return Promise.resolve(denied);
      return revealContentFileForRequest(request);
    },
  );

  ipcMain.handle(
    IPC.CONTENT_FILES_CLEAR_FOLDER,
    (
      event: IpcMainInvokeEvent,
      request: DesktopContentFilesClearFolderRequest = {},
    ): DesktopContentFilesResult => {
      const denied = requireContentFilesWebviewAccess(event);
      if (denied) return denied;
      return clearContentFilesGrant(request.folderId);
    },
  );
}
