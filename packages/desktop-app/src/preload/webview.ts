import {
  IPC,
  type DesktopContentFilesClearFolderRequest,
  type DesktopContentFileDeleteRequest,
  type DesktopContentFileRevealRequest,
  type DesktopContentFileWriteRequest,
  type DesktopContentFilesFolderRequest,
  type DesktopContentFilesResult,
  type DesktopContentFilesWriteRequest,
  type DesktopPlanFilesChooseFolderRequest,
  type DesktopPlanFilesClearFolderRequest,
  type DesktopPlanFilesFolderRequest,
  type DesktopPlanFilesReadRequest,
  type DesktopPlanFilesResult,
  type DesktopPlanFilesWriteRequest,
} from "@shared/ipc-channels";
import { contextBridge, ipcRenderer } from "electron";

const agentNativeDesktop = {
  planFiles: {
    getFolder: (
      request: DesktopPlanFilesFolderRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_GET_FOLDER, request),
    chooseFolder: (
      request: DesktopPlanFilesChooseFolderRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_CHOOSE_FOLDER, request),
    writePlan: (
      request: DesktopPlanFilesWriteRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_WRITE, request),
    readPlan: (
      request: DesktopPlanFilesReadRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_READ, request),
    clearFolder: (
      request: DesktopPlanFilesClearFolderRequest,
    ): Promise<DesktopPlanFilesResult> =>
      ipcRenderer.invoke(IPC.PLAN_FILES_CLEAR_FOLDER, request),
  },
  contentFiles: {
    getFolder: (
      request?: DesktopContentFilesFolderRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_GET_FOLDER, request),
    chooseFolder: (): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_CHOOSE_FOLDER),
    writeFiles: (
      request: DesktopContentFilesWriteRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_WRITE, request),
    writeFile: (
      request: DesktopContentFileWriteRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_WRITE_FILE, request),
    deleteFile: (
      request: DesktopContentFileDeleteRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_DELETE_FILE, request),
    readFiles: (
      request?: DesktopContentFilesFolderRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_READ, request),
    revealFile: (
      request: DesktopContentFileRevealRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_REVEAL_FILE, request),
    clearFolder: (
      request?: DesktopContentFilesClearFolderRequest,
    ): Promise<DesktopContentFilesResult> =>
      ipcRenderer.invoke(IPC.CONTENT_FILES_CLEAR_FOLDER, request),
  },
};

contextBridge.exposeInMainWorld("agentNativeDesktop", agentNativeDesktop);
